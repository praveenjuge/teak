package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.action
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.BulkResult
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.CreatedAtRange
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.LinkDetection
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.MAX_BULK_CARD_IDS
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.SimilarAnchor
import com.praveenjuge.teak.core.model.TrashCount
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import javax.inject.Inject
import javax.inject.Singleton

internal const val CARD_SOURCE = "android"

/** A library page: [search] goes as typed, and [range] narrows it to when cards were saved. */
data class CardQuery(
    val search: String = "",
    val range: CreatedAtRange? = null,
    val filters: LibraryFilters = LibraryFilters.Empty,
    val folderId: String? = null,
)

/** The library views `viewHasHiddenCards` knows. */
enum class LibraryView(val wireName: String) { All("all"), Favorites("favorites"), Archive("archive"), Trash("trash") }

interface CardsRepository {
    fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>>

    /** The full card, or null when it's gone or belongs to someone else. */
    fun card(id: String): Flow<Result<Card?>>

    suspend fun setFavorite(id: String, favorite: Boolean)
    suspend fun setArchived(id: String, archived: Boolean)
    suspend fun setDone(id: String, done: Boolean)
    suspend fun moveToTrash(id: String)
    suspend fun restore(id: String)
    suspend fun deleteForever(id: String)

    /** Deletes every card in Trash forever, page by page on the server. Returns how many it will delete. */
    suspend fun emptyTrash(): TrashCount

    /** Every card in Trash, hidden ones too, live; `more` when the count stopped before the end. */
    fun trashCount(): Flow<Result<TrashCount>>

    /** One action on many cards, in batches the backend accepts. Cards that failed come back in `failedIds`. */
    suspend fun bulk(action: BulkAction, ids: List<String>, tags: List<String> = emptyList(), folderId: String? = null): BulkResult

    /** Runs the card's processing again for fresh details, or says why it can't right now. */
    suspend fun refresh(id: String): RefreshOutcome

    suspend fun apply(id: String, changes: List<CardFieldChange>)

    suspend fun createFromText(text: String): String

    fun linkTargets(ids: List<String>): Flow<Result<List<CardLinkTarget>>>
    fun backlinks(id: String): Flow<Result<CardBacklinks>>

    /** Cards the `[[` picker offers for [query]: never Trash or [excludeCardId]; hidden ones only for a revealing tag. */
    fun linkSuggestions(query: String, excludeCardId: String): Flow<Result<List<LinkedCard>>>
    fun similarAnchor(id: String): Flow<Result<SimilarAnchor>>
    fun viewHasHiddenCards(view: LibraryView, folderId: String?): Flow<Result<Boolean>>

    /** Warms the meaning ranking the paged query reads; returns the outcome ("ok", "pending", "rate_limited"…). */
    suspend fun requestSemanticResults(search: String, folderId: String?): String
}

@Singleton
class ConvexCardsRepository @Inject constructor(
    private val convex: ConvexApi,
) : CardsRepository {
    override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
        val args = buildMap<String, Any?> {
            put("paginationOpts", mapOf("numItems" to numItems, "cursor" to cursor))
            putAll(query.filters.toSearchArgs())
            query.folderId?.let { put("folderId", it) }
            query.range?.let { put("createdAtRange", mapOf("start" to it.start, "end" to it.endExclusive)) }
            if (query.search.isNotBlank()) put("searchQuery", query.search.trim())
        }
        return convex.subscribe(ConvexFunctions.searchCardSummaries, args)
    }

    override fun card(id: String): Flow<Result<Card?>> =
        convex.subscribe(ConvexFunctions.getCard, mapOf("id" to id))

    override suspend fun setFavorite(id: String, favorite: Boolean) =
        update(id, "isFavorited", value = favorite)

    override suspend fun setArchived(id: String, archived: Boolean) = update(id, if (archived) "archive" else "unarchive")

    override suspend fun setDone(id: String, done: Boolean) = update(id, if (done) "done" else "undone")

    override suspend fun moveToTrash(id: String) = apply(id, listOf(CardFieldChange.MoveToTrash))

    override suspend fun restore(id: String) = apply(id, listOf(CardFieldChange.Restore))

    override suspend fun deleteForever(id: String) {
        convex.mutation(ConvexFunctions.permanentDeleteCard, mapOf("id" to id))
    }

    override suspend fun emptyTrash(): TrashCount = convex.mutation(ConvexFunctions.emptyTrash)

    override fun trashCount(): Flow<Result<TrashCount>> = convex.subscribe(ConvexFunctions.trashCount)

    override suspend fun bulk(action: BulkAction, ids: List<String>, tags: List<String>, folderId: String?): BulkResult {
        val updated = mutableListOf<String>()
        val failed = mutableListOf<String>()
        for (batch in ids.distinct().chunked(MAX_BULK_CARD_IDS)) {
            val args = buildMap<String, Any?> {
                put("cardIds", batch)
                put("action", action.wireName)
                if (action == BulkAction.AddTags) put("tags", tags)
                folderId?.let { put("folderId", it) }
            }
            val result = convex.mutation(ConvexFunctions.bulkUpdateCards, args)
            updated += result.updatedIds
            failed += result.failedIds
        }
        return BulkResult(updated, failed)
    }

    override suspend fun refresh(id: String): RefreshOutcome {
        val result = convex.mutation(ConvexFunctions.reprocessCard, mapOf("cardId" to id))
        val status = (result["status"] as? JsonPrimitive)?.contentOrNull
        if (status == "queued") return RefreshOutcome.Queued
        val message = (result["message"] as? JsonPrimitive)?.contentOrNull
        return RefreshOutcome.Refused(message)
    }

    override suspend fun apply(id: String, changes: List<CardFieldChange>) {
        for (change in changes) {
            convex.mutation(ConvexFunctions.updateCardField, change.args(id))
        }
    }

    override suspend fun createFromText(text: String): String {
        val resolved = LinkDetection.resolve(text)
        val args = buildMap<String, Any?> {
            put("content", resolved.content)
            put("source", CARD_SOURCE)
            if (resolved.type == CardType.Link) {
                put("type", CardType.Link.wireName)
                put("url", resolved.url)
            }
        }
        return convex.mutation(ConvexFunctions.createCard, args)
    }

    override fun linkTargets(ids: List<String>): Flow<Result<List<CardLinkTarget>>> =
        convex.subscribe(ConvexFunctions.getCardLinkTargets, mapOf("cardIds" to ids))

    override fun backlinks(id: String): Flow<Result<CardBacklinks>> =
        convex.subscribe(ConvexFunctions.getCardBacklinks, mapOf("cardId" to id))

    override fun linkSuggestions(query: String, excludeCardId: String): Flow<Result<List<LinkedCard>>> =
        convex.subscribe(ConvexFunctions.searchCardLinkSuggestions, mapOf("query" to query, "excludeCardId" to excludeCardId))

    override fun similarAnchor(id: String): Flow<Result<SimilarAnchor>> =
        convex.subscribe(ConvexFunctions.similarAnchorSummary, mapOf("cardId" to id))

    override fun viewHasHiddenCards(view: LibraryView, folderId: String?): Flow<Result<Boolean>> =
        convex.subscribe(
            ConvexFunctions.viewHasHiddenCards,
            if (folderId != null) mapOf("folderId" to folderId) else mapOf("view" to view.wireName),
        )

    override suspend fun requestSemanticResults(search: String, folderId: String?): String {
        val args = buildMap<String, Any?> {
            put("searchQuery", search)
            folderId?.let { put("folderId", it) }
        }
        val result = convex.action(ConvexFunctions.requestSemanticResults, args)
        return (result["outcome"] as? JsonPrimitive)?.contentOrNull ?: "unavailable"
    }

    private suspend fun update(id: String, field: String, value: Any? = null, sendNull: Boolean = false) {
        val args = buildMap<String, Any?> {
            put("cardId", id)
            put("field", field)
            if (value != null || sendNull) put("value", value)
        }
        convex.mutation(ConvexFunctions.updateCardField, args)
    }
}
