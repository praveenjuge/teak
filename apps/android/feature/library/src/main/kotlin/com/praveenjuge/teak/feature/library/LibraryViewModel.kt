package com.praveenjuge.teak.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardPager
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.data.repository.LibraryView
import com.praveenjuge.teak.core.data.repository.PagedCards
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.BulkCopy
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.QualifierChip
import com.praveenjuge.teak.core.model.QualifierChips
import com.praveenjuge.teak.core.model.SearchIsValue
import com.praveenjuge.teak.core.model.SearchQualifier
import com.praveenjuge.teak.core.model.SearchQuery
import com.praveenjuge.teak.core.model.SearchSimilarity
import com.praveenjuge.teak.core.model.Tags
import com.praveenjuge.teak.core.model.TimeFilter
import com.praveenjuge.teak.core.model.TimeSearch
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class EmptyKind { Search, Trash, Filters, Archive, Folder, Similar }

data class EmptyCopy(val title: String, val message: String, val kind: EmptyKind)

sealed interface LibraryEmptyState {
    data object FirstCard : LibraryEmptyState
    data class NoMatches(val copy: EmptyCopy) : LibraryEmptyState
}

sealed interface Selection {
    data object None : Selection
    data class Active(val pickedIds: List<String>) : Selection

    fun tileSelection(cardId: String): TileSelection = when (this) {
        None -> TileSelection.NotSelecting
        is Active -> if (cardId in pickedIds) TileSelection.Selected else TileSelection.Unselected
    }
}

/** A change that can be taken back: the inverse action on the cards that changed. */
data class Undo(val action: BulkAction, val ids: List<String>)

data class LibraryMessage(val id: Long, val text: String, val undo: Undo? = null)

data class LibraryUiState(
    val filters: LibraryFilters = LibraryFilters.Empty,
    val search: String = "",
    val timeFilter: TimeFilter? = null,
    val paged: PagedCards = PagedCards(),
    val selection: Selection = Selection.None,
    val isRunningBulkAction: Boolean = false,
    val folderId: String? = null,
    val folder: Folder? = null,
    /** The folder this view opened was deleted, or was never yours. */
    val folderMissing: Boolean = false,
    val folders: List<Folder> = emptyList(),
    val anchorTitle: String? = null,
    val anchorPending: Boolean = false,
    val semanticOutcome: String? = null,
    val hasHiddenCards: Boolean = false,
    val message: LibraryMessage? = null,
) {
    val isSelecting: Boolean get() = selection is Selection.Active

    val pickedIds: List<String> get() = (selection as? Selection.Active)?.pickedIds.orEmpty()

    private val parsed get() = SearchQuery.parse(search)

    /** A search for #secret or #hidden shows the cards those tags hide. */
    val showsHiddenCards: Boolean get() = parsed.tags.any(Tags::isHidden)

    val showsDone: Boolean get() = parsed.done
    val showsTodo: Boolean get() = parsed.todo

    /** Filters typed in the search, as chips; Done and To do have their own toggles in the filter row. */
    val chips: List<QualifierChip>
        get() = QualifierChips.of(search, anchorTitle).filterNot {
            it.qualifier == SearchQualifier.Is(SearchIsValue.Done) || it.qualifier == SearchQualifier.Is(SearchIsValue.Todo)
        }

    /** Folders a card can be added to: smart folders show a search, so they take no cards. */
    val manualFolders: List<Folder> get() = folders.filterNot(Folder::isSmart)

    /** The view Revisit deals its deck from: this one, as it is now. */
    val revisitQuery: CardQuery
        get() = timeFilter?.let { CardQuery(range = it.range, filters = filters, folderId = folderId) }
            ?: CardQuery(search = search, filters = filters, folderId = folderId)

    /** What Save as smart folder would save: the typed search plus the filters it can keep. */
    val smartFolderQuery: String?
        get() = if (folderId != null || timeFilter != null || search.isBlank()) null else filters.smartFolderQuery(search)

    /** The Archive view, a search for `is:archived`, or a smart folder that saves one, as on Apple. */
    val isArchive: Boolean
        get() = !filters.trashOnly &&
            (filters.archivedOnly || parsed.archived || folder?.takeIf { it.isSmart }?.query?.let { SearchQuery.parse(it).archived } == true)

    val canRevisit: Boolean get() = !filters.trashOnly && !isArchive && paged.cards.isNotEmpty()

    val title: String
        get() = when {
            selection == Selection.None -> folder?.name ?: if (folderId != null) "Folder" else filters.title
            pickedIds.isEmpty() -> "Select Cards"
            else -> "${pickedIds.size} Selected"
        }

    val emptyState: LibraryEmptyState
        get() {
            val searching = search.isNotEmpty()
            val similar = parsed.similarity is SearchSimilarity.Like
            val copy = when {
                similar -> EmptyCopy(
                    "Nothing similar yet",
                    when {
                        anchorPending || semanticOutcome == "pending" -> "Still learning about this card. Try again in a moment."
                        semanticOutcome == "rate_limited" -> "Too many searches. Try again in a minute."
                        semanticOutcome == "unavailable" -> "Couldn't search by meaning right now."
                        else -> "Try another card."
                    },
                    EmptyKind.Similar,
                )
                parsed.todo && parsed.terms.isEmpty() && parsed.phrases.isEmpty() -> EmptyCopy("Nothing left to do.", "Links you mark done leave this list.", EmptyKind.Filters)
                folderId != null && !searching -> EmptyCopy(
                    if (folder?.isSmart == true) "No cards match this smart folder." else "No cards in this folder yet.",
                    if (folder?.isSmart == true) "Cards that match its search show up here, as you save them." else "Add cards from your library to see them here.",
                    EmptyKind.Folder,
                )
                !searching && !filters.isActive -> return LibraryEmptyState.FirstCard
                !searching && filters.trashOnly ->
                    EmptyCopy("Trash Is Empty", "Cards you delete stay here for 30 days.", EmptyKind.Trash)
                !searching && filters.archivedOnly ->
                    EmptyCopy("Nothing archived", "Archive a card to keep it out of your library.", EmptyKind.Archive)
                !searching -> EmptyCopy("No Matching Cards", "Try other filters.", EmptyKind.Filters)
                else -> EmptyCopy(
                    title = "No Results for “$search”",
                    message = timeFilter?.let { "No cards from ${it.label}." } ?: "Check the spelling or try a new search.",
                    kind = EmptyKind.Search,
                )
            }
            return LibraryEmptyState.NoMatches(copy)
        }
}

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel(assistedFactory = LibraryViewModel.Factory::class)
class LibraryViewModel @AssistedInject constructor(
    @Assisted private val folderId: String?,
    private val repository: CardsRepository,
    private val folders: FoldersRepository,
) : ViewModel() {
    private val pager = CardPager(repository, viewModelScope)
    private val searchText = MutableStateFlow("")
    private val _state = MutableStateFlow(LibraryUiState(folderId = folderId))
    val state: StateFlow<LibraryUiState> = _state.asStateFlow()
    private var messageId = 0L

    init {
        val search = searchText
            .debounce { if (it.isBlank()) 0L else SEARCH_DEBOUNCE_MS }
            .map(String::trim)
            .distinctUntilChanged()
        val filters = _state.map { it.filters }.distinctUntilChanged()
        combine(search, filters) { text, chips ->
            val time = TimeSearch.parse(text)
            _state.update { it.copy(search = text, timeFilter = time) }
            if (time != null) {
                CardQuery(range = time.range, filters = chips, folderId = folderId)
            } else {
                CardQuery(search = text, filters = chips, folderId = folderId)
            }
        }
            .distinctUntilChanged()
            .onEach(pager::load)
            .launchIn(viewModelScope)
        pager.state.onEach { paged -> _state.update { it.copy(paged = paged) } }.launchIn(viewModelScope)

        folders.folders.onEach { result -> result.onSuccess { list -> _state.update { it.copy(folders = list) } } }
            .launchIn(viewModelScope)
        if (folderId != null) {
            folders.folder(folderId).onEach { result ->
                result.onSuccess { folder -> _state.update { it.copy(folder = folder, folderMissing = folder == null) } }
            }
                .launchIn(viewModelScope)
        }
        watchSimilarAnchor()
        warmMeaningSearch()
        watchHiddenCards()
    }

    /** The `like:` card's title, for its chip. */
    private fun watchSimilarAnchor() {
        _state.map { (SearchQuery.parse(it.search).similarity as? SearchSimilarity.Like)?.cardId }
            .distinctUntilChanged()
            .flatMapLatest { id -> if (id == null) flowOf(null) else repository.similarAnchor(id).map { it.getOrNull() } }
            .onEach { anchor ->
                _state.update {
                    it.copy(
                        anchorTitle = anchor?.title ?: if (anchor?.status == "unavailable") "unavailable card" else null,
                        anchorPending = anchor?.status == "pending",
                    )
                }
            }
            .launchIn(viewModelScope)
    }

    /**
     * Searches with free words or an anchor also rank by meaning: the action fills the ranking the
     * paged query reads, so results improve in place. Failures leave the keyword results as they are.
     */
    private fun warmMeaningSearch() {
        combine(searchText.debounce(SEMANTIC_DEBOUNCE_MS).map(String::trim), _state.map { it.folder?.query }) { text, scope -> text to scope }
            .distinctUntilChanged()
            .collectLatestIn { (text, scope) ->
                _state.update { it.copy(semanticOutcome = null) }
                val combined = if (scope != null) SearchQuery.combine(scope, text) else text
                if (combined == null || TimeSearch.parse(text) != null) return@collectLatestIn
                if (SearchQuery.semanticRequest(SearchQuery.parse(combined)) == null) return@collectLatestIn
                val outcome = catchingFailures { repository.requestSemanticResults(text, folderId) }.getOrDefault("unavailable")
                _state.update { it.copy(semanticOutcome = outcome) }
            }
    }

    private fun watchHiddenCards() {
        _state.map { state ->
            val idle = !state.paged.isLoading && state.paged.cards.isEmpty() && state.paged.error == null
            val plain = state.search.isEmpty() && state.filters.types.isEmpty() && state.filters.hue == null
            val view = when {
                state.filters.trashOnly -> LibraryView.Trash
                state.filters.archivedOnly -> LibraryView.Archive
                state.filters.favoritesOnly -> LibraryView.Favorites
                else -> LibraryView.All
            }
            if (idle && plain && state.folder?.isSmart != true) view to folderId else null
        }
            .distinctUntilChanged()
            .flatMapLatest { key ->
                if (key == null) flowOf(false) else repository.viewHasHiddenCards(key.first, key.second).map { it.getOrDefault(false) }
            }
            .onEach { hidden -> _state.update { it.copy(hasHiddenCards = hidden) } }
            .launchIn(viewModelScope)
    }

    private fun <T> kotlinx.coroutines.flow.Flow<T>.collectLatestIn(block: suspend (T) -> Unit) {
        viewModelScope.launch { collectLatest(block) }
    }

    fun onSearchChange(text: String) {
        searchText.value = text
    }

    fun toggleFavorites() = updateFilters { it.copy(favoritesOnly = !it.favoritesOnly) }

    fun toggleTrash() = updateFilters { it.toggleTrash() }

    fun toggleArchive() = updateFilters { it.toggleArchive() }

    fun toggleType(type: CardType) = updateFilters { it.toggleType(type) }

    fun selectHue(hue: ColorHue) = updateFilters { it.copy(hue = if (it.hue == hue) null else hue) }

    fun sort(sort: CardSort) = updateFilters { it.sorted(sort) }

    fun clearFilters() = updateFilters { LibraryFilters.Empty.copy(sort = it.sort, shuffleSeed = it.shuffleSeed) }

    private fun updateFilters(transform: (LibraryFilters) -> LibraryFilters) =
        _state.update { it.copy(filters = transform(it.filters)) }

    fun loadMore() {
        val paged = _state.value.paged
        if (paged.isLoading || paged.isLoadingMore || paged.isDone) return
        pager.loadMore()
    }

    fun refresh() = pager.refresh()

    fun beginSelection(cardId: String? = null) =
        _state.update { it.copy(selection = Selection.Active(listOfNotNull(cardId))) }

    fun toggleSelected(cardId: String) = _state.update { state ->
        val picked = (state.selection as? Selection.Active)?.pickedIds ?: return@update state
        state.copy(selection = Selection.Active(if (cardId in picked) picked - cardId else picked + cardId))
    }

    fun endSelection() = _state.update { it.copy(selection = Selection.None) }

    /** One action on the picked cards through `bulkUpdateCards`, then a note of what changed. */
    fun runOnSelected(action: BulkAction, tags: List<String> = emptyList(), folder: Folder? = null) {
        val current = _state.value
        val ids = current.pickedIds
        if (ids.isEmpty() || current.isRunningBulkAction) return
        _state.update { it.copy(isRunningBulkAction = true) }
        viewModelScope.launch {
            perform(action, ids, tags, folder)
            _state.update { it.copy(isRunningBulkAction = false, selection = Selection.None) }
        }
    }

    /** Adds the picked cards to a new folder named [name]. */
    fun addSelectedToNewFolder(name: String) {
        if (name.isBlank() || _state.value.pickedIds.isEmpty()) return
        viewModelScope.launch {
            catchingFailures { folders.create(name) }
                .onSuccess { runOnSelected(BulkAction.AddToFolder, folder = it) }
                .onFailure { post((it as? TeakException)?.message ?: "Couldn't create the folder") }
        }
    }

    /** Saves the current search as a smart folder: it shows every card that matches, as you save them. */
    fun saveSearchAsFolder(name: String) {
        val query = _state.value.smartFolderQuery ?: return
        viewModelScope.launch {
            catchingFailures { folders.create(name, query = query) }
                .onSuccess { post("Saved “${it.name}”") }
                .onFailure { post((it as? TeakException)?.message ?: "Couldn't create the folder") }
        }
    }

    /** Archive or unarchive one card from its tile, with Undo. */
    fun setArchived(cardId: String, archived: Boolean) =
        viewModelScope.launch { perform(if (archived) BulkAction.Archive else BulkAction.Unarchive, listOf(cardId)) }

    fun restoreCard(cardId: String) = viewModelScope.launch { perform(BulkAction.Restore, listOf(cardId)) }

    private suspend fun perform(action: BulkAction, ids: List<String>, tags: List<String> = emptyList(), folder: Folder? = null) {
        val result = catchingFailures { repository.bulk(action, ids, tags, folder?.id) }
        val updated = result.getOrNull()?.updatedIds.orEmpty()
        val failed = result.getOrNull()?.failedIds?.size ?: ids.size
        val undo = BulkCopy.undoOf(action)?.takeIf { updated.isNotEmpty() }?.let { Undo(it, updated) }
        post(BulkCopy.result(action, updated.size, failed, folder?.name ?: "the folder"), undo)
    }

    /** Delete forever has no bulk endpoint: one call per card, counting the ones that fail. */
    fun deleteSelectedForever() {
        val current = _state.value
        val ids = current.pickedIds
        if (ids.isEmpty() || current.isRunningBulkAction) return
        _state.update { it.copy(isRunningBulkAction = true) }
        viewModelScope.launch {
            var failed = 0
            for (id in ids) {
                catchingFailures { repository.deleteForever(id) }.onFailure { failed += 1 }
            }
            val deleted = ids.size - failed
            val text = when {
                deleted == 0 -> "Couldn't delete these cards"
                failed > 0 -> "Deleted ${BulkCopy.cardCount(deleted)}. $failed couldn't be changed."
                else -> "Deleted ${BulkCopy.cardCount(deleted)} forever"
            }
            _state.update { it.copy(isRunningBulkAction = false, selection = Selection.None) }
            post(text)
        }
    }

    fun undo(message: LibraryMessage) {
        val undo = message.undo ?: return
        dismissMessage(message.id)
        viewModelScope.launch {
            val failed = catchingFailures { repository.bulk(undo.action, undo.ids) }
                .map { it.failedIds.size }
                .getOrDefault(undo.ids.size)
            if (failed > 0) post(BulkCopy.result(undo.action, undo.ids.size - failed, failed, "the folder"))
        }
    }

    fun dismissMessage(id: Long) = _state.update { if (it.message?.id == id) it.copy(message = null) else it }

    private fun post(text: String, undo: Undo? = null) {
        messageId += 1
        _state.update { it.copy(message = LibraryMessage(messageId, text, undo)) }
    }

    @AssistedFactory
    interface Factory {
        fun create(folderId: String?): LibraryViewModel
    }

    companion object {
        const val SEARCH_DEBOUNCE_MS = 250L
        const val SEMANTIC_DEBOUNCE_MS = 300L
    }
}
