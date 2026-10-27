package com.praveenjuge.teak.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What happened to a card in the deck, so Undo can take it back. */
data class RevisitStep(val cardId: String, val archived: Boolean)

data class RevisitUiState(
    val isLoading: Boolean = true,
    val failed: Boolean = false,
    val cards: List<CardSummary> = emptyList(),
    val position: Int = 0,
    val steps: List<RevisitStep> = emptyList(),
    val archivingId: String? = null,
    /** Set after an archive, for the "Archived 1 card" note with Undo. */
    val archivedNote: Long? = null,
    /** Why the last archive or Undo didn't go through. */
    val error: UiText? = null,
) {
    val current: CardSummary? get() = cards.getOrNull(position)
    val isEmpty: Boolean get() = !isLoading && !failed && cards.isEmpty()
    val isFinished: Boolean get() = !isLoading && cards.isNotEmpty() && position >= cards.size
    val progress: UiText get() = UiText.of("native.revisit.position", (position + 1).coerceAtMost(cards.size), cards.size)
    val canUndo: Boolean get() = steps.isNotEmpty()
    val summary: UiText get() = UiText.of("native.revisit.summary", steps.count { it.archived }, steps.count { !it.archived })
}

/**
 * Revisit: up to [DECK_SIZE] cards from the current view, shuffled, one at a time. Archive takes a
 * card out of the library; Keep moves on. Undo takes back the last step.
 */
@HiltViewModel
class RevisitViewModel @Inject constructor(
    private val repository: CardsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(RevisitUiState())
    val state: StateFlow<RevisitUiState> = _state.asStateFlow()
    private var query: CardQuery? = null
    private var loading: Job? = null

    /** Deals a deck from [view]; a later call with the same view keeps the deck in progress. */
    fun start(view: CardQuery) {
        if (query == view) return
        query = view
        deal()
    }

    /** A fresh shuffle of the same view. */
    fun deal() {
        val view = query ?: return
        loading?.cancel()
        _state.value = RevisitUiState()
        val deck = view.copy(filters = view.filters.sorted(CardSort.Shuffle))
        loading = viewModelScope.launch {
            catchingFailures { readDeck(deck) }
                .onSuccess { cards -> _state.update { it.copy(isLoading = false, cards = cards) } }
                .onFailure { _state.update { it.copy(isLoading = false, failed = true) } }
        }
    }

    /** A shuffled page can come back short, so read on until the deck is full or the view runs out. */
    private suspend fun readDeck(deck: CardQuery): List<CardSummary> {
        val cards = LinkedHashMap<String, CardSummary>()
        var cursor: String? = null
        repeat(MAX_DECK_PAGES) {
            val page = repository.page(deck, cursor, DECK_SIZE - cards.size).first().getOrThrow()
            page.page.filterNot { it.archived }.forEach { cards.putIfAbsent(it.id, it) }
            cursor = page.continueCursor
            if (cards.size >= DECK_SIZE || page.isDone || cursor == null) return cards.values.take(DECK_SIZE)
        }
        return cards.values.take(DECK_SIZE)
    }

    fun keep() {
        val state = _state.value
        val card = state.current ?: return
        // While an archive is saving, the card on screen is still the one being archived.
        if (state.archivingId != null) return
        // The "Archived" note's Undo would now take back this Keep instead, so it goes.
        _state.update {
            it.copy(position = it.position + 1, steps = it.steps + RevisitStep(card.id, archived = false), archivedNote = null)
        }
    }

    fun archive() {
        val state = _state.value
        val card = state.current ?: return
        if (state.archivingId != null) return
        _state.update { it.copy(archivingId = card.id) }
        viewModelScope.launch {
            catchingFailures { repository.setArchived(card.id, true) }
                .onSuccess {
                    _state.update {
                        it.copy(
                            archivingId = null,
                            position = it.position + 1,
                            steps = it.steps + RevisitStep(card.id, archived = true),
                            archivedNote = System.nanoTime(),
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(archivingId = null, error = failureMessage(e)) } }
        }
    }

    /** Takes back the last step: an archived card goes back to the library. */
    fun undo() {
        val state = _state.value
        val last = state.steps.lastOrNull() ?: return
        if (state.archivingId != null) return
        if (!last.archived) return stepBack()
        _state.update { it.copy(archivingId = last.cardId, archivedNote = null) }
        viewModelScope.launch {
            catchingFailures { repository.setArchived(last.cardId, false) }
                .onSuccess {
                    _state.update { it.copy(archivingId = null) }
                    stepBack()
                }
                .onFailure { e -> _state.update { it.copy(archivingId = null, error = failureMessage(e)) } }
        }
    }

    private fun stepBack() = _state.update {
        it.copy(position = (it.position - 1).coerceAtLeast(0), steps = it.steps.dropLast(1), archivedNote = null)
    }

    fun noteShown() = _state.update { it.copy(archivedNote = null) }

    fun errorShown() = _state.update { it.copy(error = null) }

    private fun failureMessage(error: Throwable): UiText =
        if ((error as? TeakException)?.code == TeakException.RATE_LIMITED) {
            UiText.of("native.revisit.tooManyChanges")
        } else {
            UiText.of("native.revisit.updateFailed")
        }

    companion object {
        const val DECK_SIZE = 20
        private const val MAX_DECK_PAGES = 5
    }
}
