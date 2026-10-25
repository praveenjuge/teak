package com.praveenjuge.teak.feature.capture.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.Tags
import com.praveenjuge.teak.core.model.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Tags and a note for the card a share just made, filled in on the sheet after "Saved". */
data class ShareDetails(
    val tags: List<String> = emptyList(),
    val tagInput: String = "",
    val note: String = "",
    val isSaving: Boolean = false,
    val failed: Boolean = false,
    val hiddenHint: UiText? = null,
)

sealed interface ShareUiState {
    data object Resolving : ShareUiState
    data object Saving : ShareUiState

    /** [cardId] is the one text or link card the share made, which can take tags and a note. */
    data class Saved(val cardId: String? = null, val details: ShareDetails? = null) : ShareUiState
    data object Empty : ShareUiState
    data object SignInRequired : ShareUiState
    data class Partial(val saved: Int, val total: Int, val detail: UiText?) : ShareUiState
    data class Failed(val detail: UiText?) : ShareUiState
}

@HiltViewModel
class ShareViewModel @Inject constructor(
    private val importer: ShareImporter,
    private val cards: CardsRepository,
    @ApplicationScope private val appScope: CoroutineScope,
) : ViewModel() {
    private val _uiState = MutableStateFlow<ShareUiState>(ShareUiState.Resolving)
    val uiState: StateFlow<ShareUiState> = _uiState.asStateFlow()

    private val _close = Channel<Unit>(Channel.CONFLATED)
    val close: Flow<Unit> = _close.receiveAsFlow()

    private var started = false
    private var dismissal: Job? = null

    /** Saves the items once; later calls, like after a rotation, do nothing. */
    fun start(items: List<ShareItem>) {
        if (started) return
        started = true
        import(items)
    }

    /**
     * A new share arrived while the sheet is still open (Android delivers it to the open sheet).
     * Saves it unless the previous save is still running, which must finish first.
     */
    fun startAgain(items: List<ShareItem>) {
        if (_uiState.value == ShareUiState.Saving) return
        started = true
        dismissal?.cancel()
        _uiState.value = ShareUiState.Resolving
        import(items)
    }

    private fun import(items: List<ShareItem>) {
        val saving = appScope.async {
            catchingFailures { importer.import(items) { _uiState.value = ShareUiState.Saving } }
                .getOrElse { ShareResult.Failed(null) }
        }
        viewModelScope.launch {
            val result = saving.await()
            _uiState.value = when (result) {
                ShareResult.Empty -> ShareUiState.Empty
                ShareResult.SignInRequired -> ShareUiState.SignInRequired
                is ShareResult.Saved -> ShareUiState.Saved(cardId = result.cardIds.singleOrNull())
                is ShareResult.Partial -> ShareUiState.Partial(result.saved, result.total, result.detail)
                is ShareResult.Failed -> ShareUiState.Failed(result.detail)
            }
            if (result is ShareResult.Saved) {
                // Quick save still closes on its own; a card that can take tags waits a little longer for a tap.
                val wait = if (result.cardIds.size == 1) DETAILS_OFFER_MILLIS else SAVED_DISMISS_MILLIS
                dismissal = viewModelScope.launch {
                    delay(wait)
                    _close.send(Unit)
                }
            }
        }
    }

    /** Opens the tags and note fields, and keeps the sheet open until the user is done. */
    fun addDetails() {
        dismissal?.cancel()
        updateDetails { it }
    }

    fun updateTagInput(value: String) = updateDetails { it.copy(tagInput = value) }

    fun addTag() = updateDetails { details ->
        val tag = CardEdit.normalizeTag(details.tagInput)
        if (tag.isEmpty() || tag in details.tags) return@updateDetails details.copy(tagInput = "")
        details.copy(tags = details.tags + tag, tagInput = "", hiddenHint = Tags.hiddenHintText(details.tags, tag) ?: details.hiddenHint)
    }

    fun removeTag(tag: String) = updateDetails { it.copy(tags = it.tags - tag) }

    fun updateNote(value: String) = updateDetails { it.copy(note = value) }

    /** Writes the tags and note to the saved card, then closes. The write outlives the sheet. */
    fun saveDetails() {
        val saved = _uiState.value as? ShareUiState.Saved ?: return
        val cardId = saved.cardId ?: return
        val details = saved.details ?: return
        if (details.isSaving) return
        val pending = CardEdit.normalizeTag(details.tagInput).takeIf { it.isNotEmpty() && it !in details.tags }
        val tags = details.tags + listOfNotNull(pending)
        val changes = buildList {
            if (tags.isNotEmpty()) add(CardFieldChange.Tags(tags))
            details.note.trim().takeIf { it.isNotEmpty() }?.let { add(CardFieldChange.Notes(it)) }
        }
        if (changes.isEmpty()) {
            _close.trySend(Unit)
            return
        }
        updateDetails { it.copy(isSaving = true, failed = false) }
        val writing = appScope.async { catchingFailures { cards.apply(cardId, changes) } }
        viewModelScope.launch {
            writing.await()
                .onSuccess { _close.send(Unit) }
                .onFailure { updateDetails { it.copy(isSaving = false, failed = true) } }
        }
    }

    private fun updateDetails(transform: (ShareDetails) -> ShareDetails) = _uiState.update { state ->
        if (state is ShareUiState.Saved && state.cardId != null) state.copy(details = transform(state.details ?: ShareDetails())) else state
    }

    companion object {
        const val SAVED_DISMISS_MILLIS = 1_200L
        const val DETAILS_OFFER_MILLIS = 6_000L
    }
}
