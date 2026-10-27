package com.praveenjuge.teak.feature.card

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.teakText
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.CardEditDraft
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardLinks
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.Tags
import com.praveenjuge.teak.core.model.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EditAlert(val title: UiText, val message: UiText)

/** The `[[` picker for a note: the cards found for [query], null while the first search runs. */
data class LinkPickerState(val query: String, val cards: List<LinkedCard>? = null, val failed: Boolean = false) {
    val isLoading: Boolean get() = cards == null && !failed
}

data class CardEditUiState(
    val isLoading: Boolean = true,
    val card: Card? = null,
    /** The card never loaded because its subscription failed, so it's an error, not a deleted card. */
    val loadFailed: Boolean = false,
    val draft: CardEditDraft? = null,
    val newTag: String = "",
    val isSaving: Boolean = false,
    val alert: EditAlert? = null,
    /** Shown after adding a tag that hides the card: "Hidden. Search #secret to see it." */
    val hiddenHint: UiText? = null,
    /** Open while a `[[` is being typed in a note. */
    val linkPicker: LinkPickerState? = null,
    /** Where the note's cursor goes after a link is put in; null leaves it where the person put it. */
    val contentCursor: Int? = null,
) {
    val changes: List<CardFieldChange>
        get() = if (card != null && draft != null) CardEdit.changes(card, draft) else emptyList()
    val hasChanges: Boolean get() = changes.isNotEmpty()
    val canSave: Boolean get() = hasChanges && !isSaving
}

@HiltViewModel(assistedFactory = CardEditViewModel.Factory::class)
class CardEditViewModel @AssistedInject constructor(
    @Assisted private val cardId: String,
    private val repository: CardsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CardEditUiState())
    val uiState: StateFlow<CardEditUiState> = _uiState.asStateFlow()

    private val _done = Channel<Unit>(Channel.CONFLATED)
    val done: Flow<Unit> = _done.receiveAsFlow()

    init {
        viewModelScope.launch {
            repository.card(cardId).collect { result ->
                // A failed subscription keeps the card and the draft; only the server saying it's gone shows it missing.
                if (result.isFailure) {
                    _uiState.update { state -> if (state.isLoading) state.copy(isLoading = false, loadFailed = true) else state }
                    return@collect
                }
                val card = result.getOrNull()
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        loadFailed = false,
                        card = card,
                        draft = state.draft ?: card?.let(CardEdit::draftFor),
                    )
                }
            }
        }
    }

    private var openLink: CardLinks.OpenQuery? = null
    /** Where the `[[` the picker was closed on starts: it stays closed until that `[[` goes. */
    private var dismissedLinkStart: Int? = null
    private var linkSearch: Job? = null

    /** A typed change or a cursor move in the note or quote field; [cursor] is where the caret is. */
    fun updateContent(value: String, cursor: Int = value.length) {
        updateDraft { it.copy(editableContent = value) }
        _uiState.update { it.copy(contentCursor = null) }
        val next = if (_uiState.value.card?.type == CardType.Text) CardLinks.openQuery(value, cursor) else null
        if (next?.start != dismissedLinkStart) dismissedLinkStart = null
        showLinkPicker(next?.takeIf { it.start != dismissedLinkStart })
    }

    /** Puts a link to [card] where the `[[` and its query were typed. */
    fun pickLink(card: LinkedCard) {
        val open = openLink ?: return
        val content = _uiState.value.draft?.editableContent ?: return
        val result = CardLinks.insertingLink(content, open, card.title, card.id)
        showLinkPicker(null)
        updateDraft { it.copy(editableContent = result.text) }
        _uiState.update { it.copy(contentCursor = result.cursor) }
    }

    /** Escape, Back or a tap outside: closed until this `[[` is deleted. */
    fun dismissLinkPicker() {
        dismissedLinkStart = openLink?.start
        showLinkPicker(null)
    }

    private fun showLinkPicker(open: CardLinks.OpenQuery?) {
        val previous = openLink
        openLink = open
        if (open == null) {
            linkSearch?.cancel()
            _uiState.update { it.copy(linkPicker = null) }
            return
        }
        if (previous?.query == open.query && _uiState.value.linkPicker != null) return
        // The last answer stays up while the next one loads, so the list doesn't flash.
        _uiState.update { it.copy(linkPicker = it.linkPicker?.copy(query = open.query) ?: LinkPickerState(open.query)) }
        linkSearch?.cancel()
        linkSearch = viewModelScope.launch {
            delay(LINK_SEARCH_DEBOUNCE_MS)
            repository.linkSuggestions(open.query, cardId).collect { result ->
                _uiState.update { state ->
                    state.copy(linkPicker = state.linkPicker?.copy(cards = result.getOrNull(), failed = result.isFailure))
                }
            }
        }
    }

    fun updateNotes(value: String) = updateDraft { it.copy(notes = value) }

    fun updateNewTag(value: String) = _uiState.update { it.copy(newTag = value) }

    fun addTag() {
        val tag = CardEdit.normalizeTag(_uiState.value.newTag)
        if (tag.isEmpty()) return
        _uiState.update { state ->
            val draft = state.draft ?: return@update state
            val tags = if (tag in draft.tags) draft.tags else draft.tags + tag
            val hint = if (state.card?.isHidden == true) null else Tags.hiddenHintText(draft.tags, tag)
            state.copy(draft = draft.copy(tags = tags), newTag = "", hiddenHint = hint ?: state.hiddenHint)
        }
    }

    fun removeTag(tag: String) = _uiState.update { state ->
        val draft = state.draft ?: return@update state
        val tags = draft.tags - tag
        state.copy(draft = draft.copy(tags = tags), hiddenHint = state.hiddenHint.takeIf { Tags.isHiddenList(tags) })
    }

    fun removeAiTag(tag: String) = updateDraft { it.copy(aiTags = it.aiTags - tag) }

    fun dismissAlert() = _uiState.update { it.copy(alert = null) }

    fun save() {
        val state = _uiState.value
        val card = state.card ?: return
        if (!state.canSave) return
        if (card.type == CardType.Quote && state.draft?.editableContent.isNullOrBlank()) {
            _uiState.update { it.copy(alert = EditAlert(UiText.of("native.card.edit.quoteEmptyTitle"), UiText.of("native.card.edit.quoteEmptyMessage"))) }
            return
        }
        val changes = state.changes
        _uiState.update { it.copy(isSaving = true) }
        viewModelScope.launch {
            catchingFailures { repository.apply(card.id, changes) }
                .onSuccess { _done.send(Unit) }
                .onFailure { error ->
                    val message = error.teakText(UiText.of("native.errors.tryAgain"))
                    _uiState.update { it.copy(alert = EditAlert(UiText.of("native.card.edit.saveFailed"), message)) }
                }
            _uiState.update { it.copy(isSaving = false) }
        }
    }

    private fun updateDraft(transform: (CardEditDraft) -> CardEditDraft) = _uiState.update { state ->
        state.draft?.let { state.copy(draft = transform(it)) } ?: state
    }

    private companion object {
        /** As on the web: search once typing pauses. */
        const val LINK_SEARCH_DEBOUNCE_MS = 150L
    }

    @AssistedFactory
    interface Factory {
        fun create(cardId: String): CardEditViewModel
    }
}
