package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardSummaryPage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PagedCards(
    val cards: List<CardSummary> = emptyList(),
    /** The first page is on its way. [cards] then holds what the last load showed, if anything. */
    val isLoading: Boolean = true,
    /** [cards] are still another query's, kept on screen while this one loads: nothing should act on them. */
    val showsOtherQuery: Boolean = false,
    val isLoadingMore: Boolean = false,
    val isRefreshing: Boolean = false,
    val isDone: Boolean = false,
    val error: Throwable? = null,
)

/**
 * Infinite scroll over `searchMobileCardSummariesPaginated`. Each page is its own live
 * subscription keyed by its start cursor; Convex keeps a page's end fixed across updates, so pages
 * never overlap or leave gaps when cards are added or removed.
 */
class CardPager(
    private val repository: CardsRepository,
    private val scope: CoroutineScope,
    private val pageSize: Int = PAGE_SIZE,
) {
    private class Slot(val cursor: String?, var job: Job? = null, var page: CardSummaryPage? = null, var error: Throwable? = null)

    private val slots = mutableListOf<Slot>()
    private var query = CardQuery()
    private var refreshing = false
    private var restartedForCursor = false

    /** What showed before a new load or a refresh, kept until its first page comes, so the grid doesn't blink. */
    private var previous: List<CardSummary> = emptyList()

    /** The query the cards on screen came from. A refresh keeps it; a new query, or a refresh before it loads, doesn't. */
    private var shownQuery: CardQuery? = null
    private val _state = MutableStateFlow(PagedCards())
    val state: StateFlow<PagedCards> = _state.asStateFlow()

    fun load(newQuery: CardQuery) {
        query = newQuery
        // A new query is a new view, not a refresh of the one on screen.
        refreshing = false
        restartedForCursor = false
        restart()
    }

    fun refresh() {
        refreshing = true
        restartedForCursor = false
        restart()
    }

    fun loadMore() {
        val last = slots.lastOrNull()?.page ?: return
        if (last.isDone || last.continueCursor == null) return
        subscribe(Slot(last.continueCursor))
    }

    /** Tries the page that failed again, keeping the pages before it; a failed first page starts over. */
    fun retry() {
        val failed = slots.indexOfFirst { it.error != null }
        if (failed < 0) return
        if (failed == 0) return restart()
        val cursor = slots[failed].cursor
        slots.subList(failed, slots.size).apply { forEach { it.job?.cancel() } }.clear()
        subscribe(Slot(cursor))
    }

    private fun restart() {
        previous = _state.value.cards
        slots.forEach { it.job?.cancel() }
        slots.clear()
        subscribe(Slot(null))
    }

    private fun subscribe(slot: Slot) {
        slots += slot
        publish()
        slot.job = scope.launch {
            repository.page(query, slot.cursor, pageSize).collect { result ->
                val error = result.exceptionOrNull()
                if (slot.cursor != null && error.isInvalidCursor() && !restartedForCursor) {
                    // The paginated query changed underneath us (a backend deploy): start over,
                    // once per load, so a cursor that keeps failing shows its error instead.
                    restartedForCursor = true
                    restart()
                    return@collect
                }
                result.onSuccess {
                    slot.page = it
                    slot.error = null
                }.onFailure { slot.error = it }
                if (slot === slots.firstOrNull()) refreshing = false
                publish()
            }
        }
    }

    private fun publish() {
        val seen = HashSet<String>()
        val first = slots.firstOrNull()
        val last = slots.lastOrNull()
        val loadingFirst = first != null && first.page == null && first.error == null
        if (!loadingFirst) previous = emptyList()
        val cards = if (loadingFirst) previous else slots.flatMap { it.page?.page.orEmpty() }.filter { seen.add(it.id) }
        if (!loadingFirst) shownQuery = query
        _state.value = PagedCards(
            cards = cards,
            isLoading = loadingFirst,
            showsOtherQuery = loadingFirst && cards.isNotEmpty() && shownQuery != query,
            isLoadingMore = slots.size > 1 && last?.page == null && last?.error == null,
            isRefreshing = refreshing,
            isDone = last?.page?.isDone == true,
            error = slots.firstNotNullOfOrNull { it.error },
        )
    }

    companion object {
        const val PAGE_SIZE = 20

        private fun Throwable?.isInvalidCursor() = this?.message?.contains("InvalidCursor") == true
    }
}
