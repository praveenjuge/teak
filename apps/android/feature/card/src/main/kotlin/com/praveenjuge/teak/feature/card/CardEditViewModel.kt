package com.praveenjuge.teak.feature.card

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.CardEditDraft
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardType
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class EditAlert(val title: String, val message: String)

data class CardEditUiState(
    val isLoading: Boolean = true,
    val card: Card? = null,
    /** Seeded once from the card as it was when the screen opened. */
    val draft: CardEditDraft? = null,
    val newTag: String = "",
    val isSaving: Boolean = false,
    val alert: EditAlert? = null,
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
    /** Emits once the edits are saved. */
    val done: Flow<Unit> = _done.receiveAsFlow()

    init {
        viewModelScope.launch {
            repository.card(cardId).collect { result ->
                val card = result.getOrNull()
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        card = card,
                        draft = state.draft ?: card?.let(CardEdit::draftFor),
                    )
                }
            }
        }
    }

    fun updateContent(value: String) = updateDraft { it.copy(content = value) }

    fun updateNotes(value: String) = updateDraft { it.copy(notes = value) }

    fun updateNewTag(value: String) = _uiState.update { it.copy(newTag = value) }

    fun addTag() {
        val tag = CardEdit.normalizeTag(_uiState.value.newTag)
        if (tag.isEmpty()) return
        _uiState.update { state ->
            val draft = state.draft ?: return@update state
            val tags = if (tag in draft.tags) draft.tags else draft.tags + tag
            state.copy(draft = draft.copy(tags = tags), newTag = "")
        }
    }

    fun removeTag(tag: String) = updateDraft { it.copy(tags = it.tags - tag) }

    fun removeAiTag(tag: String) = updateDraft { it.copy(aiTags = it.aiTags - tag) }

    fun dismissAlert() = _uiState.update { it.copy(alert = null) }

    @Suppress("TooGenericExceptionCaught") // Any failure becomes an alert instead of a crash.
    fun save() {
        val state = _uiState.value
        val card = state.card ?: return
        if (!state.canSave) return
        if (card.type == CardType.Quote && state.draft?.content.isNullOrBlank()) {
            _uiState.update { it.copy(alert = EditAlert("Quote is empty", "Write the quote before saving.")) }
            return
        }
        val changes = state.changes
        _uiState.update { it.copy(isSaving = true) }
        viewModelScope.launch {
            try {
                repository.apply(card.id, changes)
                _done.send(Unit)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = (error as? TeakException)?.message ?: "Please try again."
                _uiState.update { it.copy(alert = EditAlert("Couldn't save changes", message)) }
            } finally {
                _uiState.update { it.copy(isSaving = false) }
            }
        }
    }

    private fun updateDraft(transform: (CardEditDraft) -> CardEditDraft) = _uiState.update { state ->
        state.draft?.let { state.copy(draft = transform(it)) } ?: state
    }

    @AssistedFactory
    interface Factory {
        fun create(cardId: String): CardEditViewModel
    }
}
