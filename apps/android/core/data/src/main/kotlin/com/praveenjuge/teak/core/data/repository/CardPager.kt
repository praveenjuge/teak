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
    val isLoading: Boolean = true,
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
    private val _state = MutableStateFlow(PagedCards())
    val state: StateFlow<PagedCards> = _state.asStateFlow()

    fun load(newQuery: CardQuery) {
        query = newQuery
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

    private fun restart() {
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
        val cards = slots.flatMap { it.page?.page.orEmpty() }.filter { seen.add(it.id) }
        val first = slots.firstOrNull()
        val last = slots.lastOrNull()
        _state.value = PagedCards(
            cards = cards,
            isLoading = first != null && first.page == null && first.error == null,
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
