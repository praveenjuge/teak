package com.praveenjuge.teak.feature.card

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.ShareTarget
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

data class CardDetailUiState(
    val isLoading: Boolean = true,
    val card: Card? = null,
    /** The favorite the person just chose, shown until the card catches up. */
    val favoriteOverride: Boolean? = null,
    /** A text document's own contents, once fetched. */
    val documentText: String? = null,
    /** A file is downloading to share or save. */
    val isTransferring: Boolean = false,
) {
    val isFavorited: Boolean get() = favoriteOverride ?: (card?.favorited == true)
}

sealed interface CardDetailEvent {
    data class Message(val text: String) : CardDetailEvent
    data class ShareFile(val uri: Uri, val mimeType: String) : CardDetailEvent
    /** The card is gone from this view: trashed, restored, or deleted. */
    data object Close : CardDetailEvent
}

@HiltViewModel(assistedFactory = CardDetailViewModel.Factory::class)
class CardDetailViewModel @AssistedInject constructor(
    @Assisted private val cardId: String,
    private val repository: CardsRepository,
    private val files: CardFiles,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CardDetailUiState())
    val uiState: StateFlow<CardDetailUiState> = _uiState.asStateFlow()

    private val _events = Channel<CardDetailEvent>(Channel.BUFFERED)
    val events: Flow<CardDetailEvent> = _events.receiveAsFlow()

    private var requestedDocumentText = false

    init {
        viewModelScope.launch {
            repository.card(cardId).collect { result ->
                val card = result.getOrNull()
                _uiState.update { state ->
                    val override = state.favoriteOverride.takeUnless { card != null && card.favorited == it }
                    state.copy(isLoading = false, card = card, favoriteOverride = override)
                }
                if (card != null) loadDocumentText(card)
            }
        }
    }

    fun toggleFavorite() {
        val card = _uiState.value.card ?: return
        val next = !_uiState.value.isFavorited
        _uiState.update { it.copy(favoriteOverride = next) }
        viewModelScope.launch {
            try {
                repository.setFavorite(card.id, next)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _uiState.update { it.copy(favoriteOverride = !next) }
                _events.send(CardDetailEvent.Message("Couldn't update this favorite."))
            }
        }
    }

    fun moveToTrash() = run("Couldn't delete this card.") { repository.moveToTrash(it.id) }

    fun restore() = run("Couldn't restore this card.") { repository.restore(it.id) }

    fun deleteForever() = run("Couldn't delete this card.") { repository.deleteForever(it.id) }

    /** Downloads the card's file and hands it to the share sheet. */
    fun shareFile() {
        val target = _uiState.value.card?.let(CardSheet::shareTarget) as? ShareTarget.File ?: return
        transfer("Couldn't share this file.") {
            val uri = files.shareableUri(target.url, target.fileName)
            _events.send(CardDetailEvent.ShareFile(uri, target.mimeType ?: mimeTypeFor(target.fileName)))
        }
    }

    /** Saves the original file to Downloads. */
    fun download() {
        val card = _uiState.value.card ?: return
        val url = card.fileUrl ?: return
        val fileName = CardSheet.downloadFileName(url, card.fileMetadata?.fileName, card.fileMetadata?.extension)
        transfer("Couldn't save this file.") {
            files.saveToDownloads(url, fileName, card.fileMetadata?.mimeType)
            _events.send(CardDetailEvent.Message("Saved to Downloads"))
        }
    }

    private fun run(failure: String, action: suspend (Card) -> Unit) {
        val card = _uiState.value.card ?: return
        viewModelScope.launch {
            try {
                action(card)
                _events.send(CardDetailEvent.Close)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _events.send(CardDetailEvent.Message(failure))
            }
        }
    }

    private fun transfer(failure: String, action: suspend () -> Unit) {
        if (_uiState.value.isTransferring) return
        _uiState.update { it.copy(isTransferring = true) }
        viewModelScope.launch {
            try {
                action()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _events.send(CardDetailEvent.Message(failure))
            } finally {
                _uiState.update { it.copy(isTransferring = false) }
            }
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
}
