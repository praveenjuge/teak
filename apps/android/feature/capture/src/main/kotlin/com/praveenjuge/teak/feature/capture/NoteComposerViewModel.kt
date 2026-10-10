package com.praveenjuge.teak.feature.capture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardsRepository
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
import javax.inject.Inject

/** A failed save, worded for an alert. */
data class SaveError(val title: String, val message: String)

data class NoteComposerUiState(
    val isSaving: Boolean = false,
    val error: SaveError? = null,
) {
    fun canSave(text: CharSequence): Boolean = text.isNotBlank() && !isSaving
}

@HiltViewModel
class NoteComposerViewModel @Inject constructor(
    private val cards: CardsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(NoteComposerUiState())
    val uiState: StateFlow<NoteComposerUiState> = _uiState.asStateFlow()

    private val _saved = Channel<Unit>(Channel.BUFFERED)
    /** Fires once the card exists, so the screen can close. */
    val saved: Flow<Unit> = _saved.receiveAsFlow()

    /** Saves the text as a note, or as a link when it's a URL. */
    @Suppress("TooGenericExceptionCaught") // Any failure becomes a message on the composer.
    fun save(text: String) {
        if (!_uiState.value.canSave(text)) return
        _uiState.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            val error = try {
                cards.createFromText(text)
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: TeakException) {
                if (e.code == TeakException.CARD_LIMIT_REACHED) {
                    SaveError("Card limit reached", e.message ?: "You've reached the Free plan's card limit.")
                } else {
                    GENERIC_ERROR
                }
            } catch (e: Exception) {
                GENERIC_ERROR
            }
            _uiState.update { it.copy(isSaving = false, error = error) }
            if (error == null) _saved.send(Unit)
        }
    }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    private companion object {
        val GENERIC_ERROR = SaveError("Couldn't save", "Failed to save card. Please try again.")
    }
}
