package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.LibraryView
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.BulkResult
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.SimilarAnchor
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

class FakeCardsRepository : CardsRepository {
    val summaries = MutableStateFlow<List<CardSummary>>(emptyList())
    val cards = MutableStateFlow<Map<String, Card>>(emptyMap())
    val queries = mutableListOf<CardQuery>()
    val writes = mutableListOf<String>()
    val created = mutableListOf<String>()
    val semanticRequests = mutableListOf<String>()
    val linkTargetRequests = mutableListOf<List<String>>()
    var failingIds: Set<String> = emptySet()
    var createError: Exception? = null
    var refreshOutcome: RefreshOutcome = RefreshOutcome.Queued
    var semanticError: Exception? = null
    var linkTargets: List<CardLinkTarget> = emptyList()
    var backlinks = CardBacklinks()
    /** Cards the `[[` picker can find; a query matches a title containing it. */
    var linkableCards: List<LinkedCard> = emptyList()
    val linkSuggestionQueries = mutableListOf<String>()
    var linkSuggestionError: Exception? = null
    var hiddenCards = false

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

    override suspend fun setArchived(id: String, archived: Boolean) {
        write("${if (archived) "archive" else "unarchive"}:$id", id) { it.copy(isArchived = archived.takeIf { a -> a }) }
        summaries.value = summaries.value.map { if (it.id == id) it.copy(isArchived = archived.takeIf { a -> a }) else it }
    }

    override suspend fun setDone(id: String, done: Boolean) = write("${if (done) "done" else "undone"}:$id", id) {
        it.copy(completedAt = if (done) 1.0 else null)
    }

    override suspend fun moveToTrash(id: String) = write("trash:$id", id) { it.copy(isDeleted = true) }

    override suspend fun restore(id: String) = write("restore:$id", id) { it.copy(isDeleted = null) }

    override suspend fun deleteForever(id: String) {
        write("deleteForever:$id", id) { it }
        cards.value = cards.value - id
        summaries.value = summaries.value.filterNot { it.id == id }
    }

    override suspend fun bulk(action: BulkAction, ids: List<String>, tags: List<String>, folderId: String?): BulkResult {
        val failed = ids.filter { it in failingIds }
        val updated = ids - failed.toSet()
        val detail = when (action) {
            BulkAction.AddTags -> ":${tags.joinToString(",")}"
            BulkAction.AddToFolder -> ":$folderId"
            else -> ""
        }
        writes += "bulk:${action.wireName}:${updated.joinToString(",")}$detail"
        return BulkResult(updated, failed)
    }

    override suspend fun refresh(id: String): RefreshOutcome {
        if (id in failingIds) throw IllegalStateException("Refresh failed for $id")
        writes += "refresh:$id"
        return refreshOutcome
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

    override fun linkTargets(ids: List<String>): Flow<Result<List<CardLinkTarget>>> {
        linkTargetRequests += ids
        return flowOf(Result.success(linkTargets.filter { it.id in ids }))
    }

    override fun backlinks(id: String): Flow<Result<CardBacklinks>> = flowOf(Result.success(backlinks))

    override fun linkSuggestions(query: String, excludeCardId: String): Flow<Result<List<LinkedCard>>> {
        linkSuggestionQueries += query
        val error = linkSuggestionError
        if (error != null) return flowOf(Result.failure(error))
        return flowOf(Result.success(linkableCards.filter { it.id != excludeCardId && it.title.contains(query, ignoreCase = true) }))
    }

    override fun similarAnchor(id: String): Flow<Result<SimilarAnchor>> =
        cards.map { Result.success(it[id]?.let { card -> SimilarAnchor("ok", card.content) } ?: SimilarAnchor("unavailable")) }

    override fun viewHasHiddenCards(view: LibraryView, folderId: String?): Flow<Result<Boolean>> = flowOf(Result.success(hiddenCards))

    override suspend fun requestSemanticResults(search: String, folderId: String?): String {
        semanticError?.let { throw it }
        semanticRequests += search
        return "ok"
    }

    private fun write(label: String, id: String, transform: (Card) -> Card) {
        if (id in failingIds) throw IllegalStateException("Write failed for $id")
        writes += label
        cards.value[id]?.let { cards.value = cards.value + (id to transform(it)) }
    }
}
