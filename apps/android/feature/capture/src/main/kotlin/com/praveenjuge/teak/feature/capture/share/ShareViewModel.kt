package com.praveenjuge.teak.feature.capture.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface ShareUiState {
    /** Waiting to learn whether someone is signed in. */
    data object Resolving : ShareUiState
    data object Saving : ShareUiState
    data object Saved : ShareUiState
    data object Empty : ShareUiState
    data object SignInRequired : ShareUiState
    data class Partial(val saved: Int, val total: Int, val detail: String?) : ShareUiState
    data class Failed(val detail: String?) : ShareUiState
}

@HiltViewModel
class ShareViewModel @Inject constructor(
    private val importer: ShareImporter,
) : ViewModel() {
    private val _uiState = MutableStateFlow<ShareUiState>(ShareUiState.Resolving)
    val uiState: StateFlow<ShareUiState> = _uiState.asStateFlow()

    private val _close = Channel<Unit>(Channel.CONFLATED)
    /** Fires when the sheet should close by itself, a moment after a save. */
    val close: Flow<Unit> = _close.receiveAsFlow()

    private var started = false

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
        _uiState.value = ShareUiState.Resolving
        import(items)
    }

    @Suppress("TooGenericExceptionCaught") // Any failure becomes a message on the sheet.
    private fun import(items: List<ShareItem>) {
        viewModelScope.launch {
            val result = try {
                importer.import(items) { _uiState.value = ShareUiState.Saving }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                ShareResult.Failed(null)
            }
            _uiState.value = when (result) {
                ShareResult.Empty -> ShareUiState.Empty
                ShareResult.SignInRequired -> ShareUiState.SignInRequired
                ShareResult.Saved -> ShareUiState.Saved
                is ShareResult.Partial -> ShareUiState.Partial(result.saved, result.total, result.detail)
                is ShareResult.Failed -> ShareUiState.Failed(result.detail)
            }
            if (result == ShareResult.Saved) {
                delay(SAVED_DISMISS_MILLIS)
                _close.send(Unit)
            }
        }
    }

    companion object {
        const val SAVED_DISMISS_MILLIS = 1_200L
    }
}
