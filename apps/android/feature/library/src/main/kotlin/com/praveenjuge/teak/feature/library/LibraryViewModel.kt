package com.praveenjuge.teak.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.repository.CardPager
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.PagedCards
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.TimeFilter
import com.praveenjuge.teak.core.model.TimeSearch
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Which icon an empty grid shows next to its copy. */
enum class EmptyKind { Search, Trash, Filters }

data class EmptyCopy(val title: String, val message: String, val kind: EmptyKind)

/** How many cards a bulk action couldn't change. */
data class BulkFailure(val failed: Int, val total: Int) {
    val message: String get() = "$failed of $total failed. Please try again."
}

data class LibraryUiState(
    val filters: LibraryFilters = LibraryFilters.Empty,
    /** The debounced, trimmed search the grid is showing. */
    val search: String = "",
    /** Set when [search] reads as a date, like "last week"; the grid then filters by that range. */
    val timeFilter: TimeFilter? = null,
    val paged: PagedCards = PagedCards(),
    /** Null when not selecting. Keeps the order cards were picked in. */
    val selection: Set<String>? = null,
    val isRunningBulkAction: Boolean = false,
    val bulkFailure: BulkFailure? = null,
) {
    val isSelecting: Boolean get() = selection != null

    val title: String
        get() = when {
            selection == null -> filters.title
            selection.isEmpty() -> "Select Cards"
            else -> "${selection.size} Selected"
        }

    /** Copy for an empty grid, or null for a brand-new library, which gets the first-card prompt. */
    val emptyCopy: EmptyCopy?
        get() {
            val searching = search.isNotEmpty()
            return when {
                !searching && !filters.isActive -> null
                !searching && filters.trashOnly ->
                    EmptyCopy("Trash Is Empty", "Cards you delete stay here for 30 days.", EmptyKind.Trash)
                !searching -> EmptyCopy("No Matching Cards", "Try other filters.", EmptyKind.Filters)
                else -> EmptyCopy(
                    title = "No Results for “$search”",
                    message = timeFilter?.let { "No cards from ${it.label}." } ?: "Check the spelling or try a new search.",
                    kind = EmptyKind.Search,
                )
            }
        }
}

/** The library grid: search, filter chips, infinite scroll, and multi-select actions. */
@OptIn(FlowPreview::class)
@HiltViewModel
class LibraryViewModel @Inject constructor(
    private val repository: CardsRepository,
) : ViewModel() {
    private val pager = CardPager(repository, viewModelScope)
    private val searchText = MutableStateFlow("")
    private val _state = MutableStateFlow(LibraryUiState())
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()

    init {
        // Clearing the search shows everything right away; typing waits for a pause, like iOS.
        val search = searchText
            .debounce { if (it.isBlank()) 0L else SEARCH_DEBOUNCE_MS }
            .map(String::trim)
            .distinctUntilChanged()
        val filters = _state.map { it.filters }.distinctUntilChanged()
        combine(search, filters) { text, chips ->
            val time = TimeSearch.parse(text)
            _state.update { it.copy(search = text, timeFilter = time) }
            // A date search filters by when cards were saved, without searching their text.
            if (time != null) CardQuery(range = time.range, filters = chips) else CardQuery(search = text, filters = chips)
        }
            .distinctUntilChanged()
            .onEach(pager::load)
            .launchIn(viewModelScope)
        pager.state.onEach { paged -> _state.update { it.copy(paged = paged) } }.launchIn(viewModelScope)
    }

    fun onSearchChange(text: String) {
        searchText.value = text
    }

    fun toggleFavorites() = updateFilters { it.copy(favoritesOnly = !it.favoritesOnly) }

    fun toggleTrash() = updateFilters { it.copy(trashOnly = !it.trashOnly) }

    fun toggleType(type: CardType) = updateFilters { it.toggleType(type) }

    /** Picking the current color again clears it. */
    fun selectHue(hue: ColorHue) = updateFilters { it.copy(hue = if (it.hue == hue) null else hue) }

    fun clearFilters() = updateFilters { LibraryFilters.Empty }

    private fun updateFilters(transform: (LibraryFilters) -> LibraryFilters) =
        _state.update { it.copy(filters = transform(it.filters)) }

    fun loadMore() {
        val paged = _state.value.paged
        if (paged.isLoading || paged.isLoadingMore || paged.isDone) return
        pager.loadMore()
    }

    fun refresh() = pager.refresh()

    /** Starts selecting, optionally with the card that was long-pressed. */
    fun beginSelection(cardId: String? = null) =
        _state.update { it.copy(selection = setOfNotNull(cardId)) }

    fun toggleSelected(cardId: String) = _state.update { state ->
        val current = state.selection ?: return@update state
        state.copy(selection = if (cardId in current) current - cardId else current + cardId)
    }

    fun endSelection() = _state.update { it.copy(selection = null) }

    fun moveSelectedToTrash() = runBulk(repository::moveToTrash)

    fun restoreSelected() = runBulk(repository::restore)

    fun deleteSelectedForever() = runBulk(repository::deleteForever)

    fun dismissBulkFailure() = _state.update { it.copy(bulkFailure = null) }

    /** There are no bulk endpoints: one call per card, in order, counting the ones that fail. */
    private fun runBulk(action: suspend (String) -> Unit) {
        val current = _state.value
        val ids = current.selection?.toList().orEmpty()
        if (ids.isEmpty() || current.isRunningBulkAction) return
        _state.update { it.copy(isRunningBulkAction = true) }
        viewModelScope.launch {
            var failed = 0
            for (id in ids) {
                try {
                    action(id)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    failed += 1
                }
            }
            _state.update {
                it.copy(
                    isRunningBulkAction = false,
                    selection = null,
                    bulkFailure = if (failed > 0) BulkFailure(failed, ids.size) else null,
                )
            }
        }
    }

    companion object {
        const val SEARCH_DEBOUNCE_MS = 250L
    }
}
