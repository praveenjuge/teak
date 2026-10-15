package com.praveenjuge.teak.feature.capture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    val saved: Flow<Unit> = _saved.receiveAsFlow()

    fun save(text: String) {
        if (!_uiState.value.canSave(text)) return
        _uiState.update { it.copy(isSaving = true, error = null) }
        viewModelScope.launch {
            val error = catchingFailures { cards.createFromText(text) }.exceptionOrNull()?.let(::saveError)
            _uiState.update { it.copy(isSaving = false, error = error) }
            if (error == null) _saved.send(Unit)
        }
    }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    private fun saveError(error: Throwable): SaveError =
        if (error is TeakException && error.code == TeakException.CARD_LIMIT_REACHED) {
            SaveError("Card limit reached", error.message ?: "You've reached the Free plan's card limit.")
        } else {
            GENERIC_ERROR
        }

    private companion object {
        val GENERIC_ERROR = SaveError("Couldn't save", "Failed to save card. Please try again.")
    }
}
