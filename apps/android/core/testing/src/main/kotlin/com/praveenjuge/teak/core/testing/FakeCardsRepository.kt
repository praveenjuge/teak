package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardSummaryPage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/**
 * An in-memory library. Pages are live: changing [summaries] or [cards] re-emits every open page,
 * like a Convex subscription. Set [failingIds] to make writes for those cards throw.
 */
class FakeCardsRepository : CardsRepository {
    val summaries = MutableStateFlow<List<CardSummary>>(emptyList())
    val cards = MutableStateFlow<Map<String, Card>>(emptyMap())
    val queries = mutableListOf<CardQuery>()
    val writes = mutableListOf<String>()
    val created = mutableListOf<String>()
    var failingIds: Set<String> = emptySet()
    var createError: Exception? = null

    override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
        queries += query
        return summaries.map { all ->
            val start = cursor?.toInt() ?: 0
            val end = minOf(all.size, start + numItems)
            Result.success(
                CardSummaryPage(
                    page = all.subList(minOf(start, end), end),
                    isDone = end >= all.size,
                    continueCursor = end.toString(),
                ),
            )
        }
    }

    override fun card(id: String): Flow<Result<Card?>> = cards.map { Result.success(it[id]) }

    override suspend fun setFavorite(id: String, favorite: Boolean) = write("favorite:$id:$favorite", id) {
        it.copy(isFavorited = favorite)
    }

    override suspend fun moveToTrash(id: String) = write("trash:$id", id) { it.copy(isDeleted = true) }

    override suspend fun restore(id: String) = write("restore:$id", id) { it.copy(isDeleted = null) }

    override suspend fun deleteForever(id: String) {
        write("deleteForever:$id", id) { it }
        cards.value = cards.value - id
        summaries.value = summaries.value.filterNot { it.id == id }
    }

    override suspend fun apply(id: String, changes: List<CardFieldChange>) {
        for (change in changes) {
            write("edit:$id:$change", id) { card ->
                when (change) {
                    is CardFieldChange.Content -> card.copy(content = change.value)
                    is CardFieldChange.Notes -> card.copy(notes = change.value)
                    is CardFieldChange.Tags -> card.copy(tags = change.value)
                    is CardFieldChange.RemoveAiTag -> card.copy(aiTags = card.aiTags.orEmpty() - change.tag)
                }
            }
        }
    }

    override suspend fun createFromText(text: String): String {
        createError?.let { throw it }
        created += text
        return "new-${created.size}"
    }

    private fun write(label: String, id: String, transform: (Card) -> Card) {
        if (id in failingIds) throw IllegalStateException("Write failed for $id")
        writes += label
        cards.value[id]?.let { cards.value = cards.value + (id to transform(it)) }
    }
}
