package com.praveenjuge.teak.feature.card

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.teakText
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.BulkCopy
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.MarkdownListItem
import com.praveenjuge.teak.core.model.TaskLists
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardLinks
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.LinkState
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.ShareTarget
import com.praveenjuge.teak.core.model.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CardDetailUiState(
    val isLoading: Boolean = true,
    val card: Card? = null,
    val favoriteOverride: Boolean? = null,
    val doneOverride: Boolean? = null,
    val documentText: String? = null,
    val isTransferring: Boolean = false,
    val isRefreshing: Boolean = false,
    val linkTargets: Map<String, CardLinkTarget> = emptyMap(),
    val backlinks: CardBacklinks = CardBacklinks(),
    val folders: List<Folder> = emptyList(),
    /** A note's content with a ticked task, shown until the saved card catches up. */
    val contentOverride: String? = null,
) {
    /** The card as shown, with any task tick that's still saving. */
    val displayedCard: Card? get() = contentOverride?.let { content -> card?.copy(content = content) } ?: card

    val isFavorited: Boolean get() = favoriteOverride ?: (card?.favorited == true)
    val isDone: Boolean get() = doneOverride ?: (card?.isDone == true)

    /** Links can be marked done; a card in Trash has to come back first. */
    val canMarkDone: Boolean get() = card?.type == CardType.Link && card.deleted.not()

    val doneText: UiText get() = LinkState.toggleText(card?.linkCategoryName, isDone)

    val cardFolders: List<Folder> get() = card?.folderIds.orEmpty().mapNotNull { id -> folders.firstOrNull { it.id == id } }
}

sealed interface CardDetailEvent {
    data class Message(val text: UiText, val undo: (() -> Unit)? = null) : CardDetailEvent
    data class ShareFile(val uri: Uri, val mimeType: String) : CardDetailEvent
    data object Close : CardDetailEvent
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel(assistedFactory = CardDetailViewModel.Factory::class)
class CardDetailViewModel @AssistedInject constructor(
    @Assisted private val cardId: String,
    private val repository: CardsRepository,
    private val folders: FoldersRepository,
    private val files: CardFiles,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CardDetailUiState())
    val uiState: StateFlow<CardDetailUiState> = _uiState.asStateFlow()

    private val _events = Channel<CardDetailEvent>(Channel.BUFFERED)
    val events: Flow<CardDetailEvent> = _events.receiveAsFlow()

    private var requestedDocumentText = false
    private var taskSaves = 0

    init {
        viewModelScope.launch {
            repository.card(cardId).collect { result ->
                val card = result.getOrNull()
                _uiState.update { state ->
                    val favorite = state.favoriteOverride.takeUnless { card != null && card.favorited == it }
                    val done = state.doneOverride.takeUnless { card != null && card.isDone == it }
                    val content = state.contentOverride.takeUnless { card?.content == it || taskSaves == 0 }
                    state.copy(isLoading = false, card = card, favoriteOverride = favorite, doneOverride = done, contentOverride = content)
                }
                if (card != null) loadDocumentText(card)
            }
        }
        // One subscription for every `[[` link on the card, renewed only when the set of ids changes.
        _uiState.map { state -> state.card?.let { CardLinks.parseIds(it.content) + CardLinks.parseIds(it.notes) }?.distinct() }
            .filterNotNull()
            .distinctUntilChanged()
            .flatMapLatest { ids -> if (ids.isEmpty()) flowOf(emptyList()) else repository.linkTargets(ids).map { it.getOrDefault(emptyList()) } }
            .onEach { targets -> _uiState.update { it.copy(linkTargets = targets.associateBy(CardLinkTarget::id)) } }
            .launchIn(viewModelScope)
        repository.backlinks(cardId)
            .onEach { result -> result.onSuccess { links -> _uiState.update { it.copy(backlinks = links) } } }
            .launchIn(viewModelScope)
        folders.folders
            .onEach { result -> result.onSuccess { list -> _uiState.update { it.copy(folders = list) } } }
            .launchIn(viewModelScope)
    }

    fun toggleFavorite() {
        val card = _uiState.value.card ?: return
        val next = !_uiState.value.isFavorited
        _uiState.update { it.copy(favoriteOverride = next) }
        viewModelScope.launch {
            catchingFailures { repository.setFavorite(card.id, next) }.onFailure {
                _uiState.update { it.copy(favoriteOverride = !next) }
                _events.send(CardDetailEvent.Message(UiText.of("native.card.failed.favorite")))
            }
        }
    }

    /**
     * Ticks or unticks one task in a note at once, moving it as the web does, and saves the note. A failed save puts
     * the note back and says so.
     */
    fun toggleTask(item: MarkdownListItem) {
        val card = _uiState.value.displayedCard ?: return
        if (card.type != CardType.Text || card.deleted) return
        val next = TaskLists.toggle(card.content, item) ?: return
        _uiState.update { it.copy(contentOverride = next) }
        taskSaves += 1
        viewModelScope.launch {
            val result = catchingFailures { repository.apply(card.id, listOf(CardFieldChange.Content(next))) }
            taskSaves -= 1
            result
                .onSuccess {
                    _uiState.update { state ->
                        if (taskSaves == 0 && state.card?.content == state.contentOverride) state.copy(contentOverride = null) else state
                    }
                }
                .onFailure {
                    _uiState.update { it.copy(contentOverride = null) }
                    _events.send(CardDetailEvent.Message(UiText.of("native.notes.taskFailed")))
                }
        }
    }

    /** Marks a link done (read, watched…) at once, and takes it back if the change fails. */
    fun toggleDone() {
        val state = _uiState.value
        val card = state.card ?: return
        if (!state.canMarkDone) return
        val next = !state.isDone
        _uiState.update { it.copy(doneOverride = next) }
        viewModelScope.launch {
            catchingFailures { repository.setDone(card.id, next) }
                .onSuccess {
                    _events.send(
                        CardDetailEvent.Message(LinkState.toggledText(card.linkCategoryName, next)) {
                            _uiState.update { it.copy(doneOverride = !next) }
                            viewModelScope.launch {
                                catchingFailures { repository.setDone(card.id, !next) }.onFailure {
                                    _uiState.update { it.copy(doneOverride = next) }
                                    _events.send(CardDetailEvent.Message(UiText.of("native.card.failed.undo")))
                                }
                            }
                        },
                    )
                }
                .onFailure {
                    _uiState.update { it.copy(doneOverride = !next) }
                    _events.send(CardDetailEvent.Message(UiText.of("native.card.failed.update")))
                }
        }
    }

    fun toggleArchived() {
        val card = _uiState.value.card ?: return
        val archive = !card.archived
        viewModelScope.launch {
            catchingFailures { repository.setArchived(card.id, archive) }
                .onSuccess {
                    val text = BulkCopy.result(if (archive) BulkAction.Archive else BulkAction.Unarchive, updated = 1, failedCount = 0)
                    _events.send(
                        CardDetailEvent.Message(text) {
                            viewModelScope.launch {
                                catchingFailures { repository.setArchived(card.id, !archive) }
                                    .onFailure { _events.send(CardDetailEvent.Message(UiText.of("native.card.failed.undo"))) }
                            }
                        },
                    )
                }
                .onFailure { _events.send(CardDetailEvent.Message(if (archive) UiText.of("native.card.failed.archive") else UiText.of("native.card.failed.unarchive"))) }
        }
    }

    /** Runs processing again for fresh details; the server may refuse, with a reason to show. */
    fun refreshDetails() {
        val card = _uiState.value.card ?: return
        if (_uiState.value.isRefreshing) return
        _uiState.update { it.copy(isRefreshing = true) }
        viewModelScope.launch {
            val text = catchingFailures {
                when (val outcome = repository.refresh(card.id)) {
                    RefreshOutcome.Queued -> UiText.of("native.card.notice.refreshing")
                    is RefreshOutcome.Refused -> outcome.message?.let(UiText::verbatim) ?: UiText.of("native.card.failed.refresh")
                }
            }.getOrElse { e ->
                (e as? TeakException)?.takeIf { it.code in REFUSAL_CODES }?.text ?: UiText.of("native.card.failed.refresh")
            }
            _uiState.update { it.copy(isRefreshing = false) }
            _events.send(CardDetailEvent.Message(text))
        }
    }

    fun setFolders(folderIds: List<String>) {
        val card = _uiState.value.card ?: return
        viewModelScope.launch {
            catchingFailures { folders.setCardFolders(card.id, folderIds) }.onFailure { error ->
                _events.send(CardDetailEvent.Message(error.teakText(UiText.of("native.card.failed.folders"))))
            }
        }
    }

    fun createFolder(name: String, then: (Folder) -> Unit) {
        viewModelScope.launch {
            catchingFailures { folders.create(name) }
                .onSuccess(then)
                .onFailure { error -> _events.send(CardDetailEvent.Message(error.teakText(UiText.of("native.folders.createFailed")))) }
        }
    }

    fun moveToTrash() = run(UiText.of("native.card.failed.moveToTrash")) { repository.moveToTrash(it.id) }

    fun restore() = run(UiText.of("native.card.failed.restore")) { repository.restore(it.id) }

    fun deleteForever() = run(UiText.of("native.card.failed.delete")) { repository.deleteForever(it.id) }

    fun shareFile() {
        val target = _uiState.value.card?.let(CardSheet::shareTarget) as? ShareTarget.File ?: return
        transfer(UiText.of("native.actions.shareFailed")) {
            val uri = files.shareableUri(target.url, target.fileName)
            _events.send(CardDetailEvent.ShareFile(uri, target.mimeType ?: mimeTypeFor(target.fileName)))
        }
    }

    fun download() {
        val card = _uiState.value.card ?: return
        val url = card.fileUrl ?: return
        val fileName = CardSheet.downloadFileName(url, card.fileMetadata?.fileName, card.fileMetadata?.extension)
        transfer(UiText.of("native.card.failed.saveFile")) {
            files.saveToDownloads(url, fileName, card.fileMetadata?.mimeType)
            _events.send(CardDetailEvent.Message(UiText.of("android.card.savedToDownloads")))
        }
    }

    private fun run(failure: UiText, action: suspend (Card) -> Unit) {
        val card = _uiState.value.card ?: return
        viewModelScope.launch {
            catchingFailures { action(card) }
                .onSuccess { _events.send(CardDetailEvent.Close) }
                .onFailure { _events.send(CardDetailEvent.Message(failure)) }
        }
    }

    private fun transfer(failure: UiText, action: suspend () -> Unit) {
        if (_uiState.value.isTransferring) return
        _uiState.update { it.copy(isTransferring = true) }
        viewModelScope.launch {
            catchingFailures { action() }.onFailure { _events.send(CardDetailEvent.Message(failure)) }
            _uiState.update { it.copy(isTransferring = false) }
        }
    }

    private fun loadDocumentText(card: Card) {
        if (requestedDocumentText || textPreviewKind(card) == null) return
        val url = safeExternalUrl(card.fileUrl) ?: return
        requestedDocumentText = true
        viewModelScope.launch {
            val text = files.fetchText(url) ?: return@launch
            _uiState.update { it.copy(documentText = text) }
        }
    }

    @AssistedFactory
    interface Factory {
        fun create(cardId: String): CardDetailViewModel
    }

    private companion object {
        val REFUSAL_CODES = setOf("CONFLICT", "NOT_FOUND", "RATE_LIMITED")
    }
}
