package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.action
import com.praveenjuge.teak.core.data.convex.isOffline
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.data.offline.OfflineCopies
import com.praveenjuge.teak.core.data.offline.Outbox
import com.praveenjuge.teak.core.data.offline.OutboxItem
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
import com.praveenjuge.teak.core.model.PendingEdits
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.SimilarAnchor
import com.praveenjuge.teak.core.model.TrashCount
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File
import java.io.IOException
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

/**
 * Cards on the server, with edits made offline laid over them until they're sent. Single-card edits, and bulk ones
 * that act on each card alone, wait in the [Outbox] when Teak is offline instead of failing; anything else that
 * needs the server fails offline with [TeakException.OFFLINE].
 */
interface CardsRepository {
    fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>>

    /** The full card, or null when it's gone or belongs to someone else. A card kept offline shows at once. */
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

    /** The new card's id, or null when Teak is offline and the text waits to be saved. */
    suspend fun createFromText(text: String): String?

    /** Ids of the cards kept for offline use. */
    val keptOffline: Flow<Set<String>>

    /** Keeps [card] and its file on the device for offline use. */
    suspend fun keepOffline(card: Card)

    suspend fun removeOfflineCopy(id: String)

    /** A kept card's file on the device, to open instead of downloading it. */
    fun offlineFile(id: String): File?

    /** Goes up whenever a kept card or its file changes, so a screen showing [offlineFile] reads it again. */
    val offlineChanges: Flow<Long>

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
    private val outbox: Outbox,
    private val copies: OfflineCopies,
) : CardsRepository {
    override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
        val args = buildMap<String, Any?> {
            put("paginationOpts", mapOf("numItems" to numItems, "cursor" to cursor))
            putAll(query.filters.toSearchArgs())
            query.folderId?.let { put("folderId", it) }
            query.range?.let { put("createdAtRange", mapOf("start" to it.start, "end" to it.endExclusive)) }
            if (query.search.isNotBlank()) put("searchQuery", query.search.trim())
        }
        return combine(convex.subscribe(ConvexFunctions.searchCardSummaries, args), outbox.pendingEdits) { result, pending ->
            result.map { page -> page.withPending(pending, query.filters) }
        }
    }

    override fun card(id: String): Flow<Result<Card?>> {
        val shown = flow {
            copies.card(id)?.let { emit(Result.success(it)) }
            emitAll(
                convex.subscribe(ConvexFunctions.getCard, mapOf("id" to id))
                    // Refreshing the kept copy is best-effort: a full disk mustn't stop the card's updates.
                    .onEach { result ->
                        if (result.isFailure) return@onEach
                        val card = result.getOrNull()
                        try {
                            // The server answering "no such card" means it was deleted for good: so is its copy.
                            if (card == null) copies.remove(id) else copies.update(card)
                        } catch (_: IOException) {
                        }
                    },
            )
        }
        val pending = outbox.pendingEdits.map { it[id].orEmpty() }.distinctUntilChanged()
        return combine(shown, pending) { result, changes ->
            if (changes.isEmpty()) result else result.map { card -> card?.let { PendingEdits.apply(it, changes, now()) } }
        }
    }

    override suspend fun setFavorite(id: String, favorite: Boolean) = apply(id, listOf(CardFieldChange.Favorite(favorite)))

    override suspend fun setArchived(id: String, archived: Boolean) = apply(id, listOf(CardFieldChange.Archive(archived)))

    override suspend fun setDone(id: String, done: Boolean) = apply(id, listOf(CardFieldChange.Done(done)))

    override suspend fun moveToTrash(id: String) = apply(id, listOf(CardFieldChange.MoveToTrash))

    override suspend fun restore(id: String) = apply(id, listOf(CardFieldChange.Restore))

    override suspend fun deleteForever(id: String) {
        convex.mutation(ConvexFunctions.permanentDeleteCard, mapOf("id" to id))
        copies.remove(id)
    }

    override suspend fun emptyTrash(): TrashCount {
        val count = convex.mutation(ConvexFunctions.emptyTrash)
        // Kept cards that were in Trash are being deleted for good, so their copies go now.
        for (id in copies.kept.value) {
            if (copies.card(id)?.deleted == true) copies.remove(id)
        }
        return count
    }

    override fun trashCount(): Flow<Result<TrashCount>> = convex.subscribe(ConvexFunctions.trashCount)

    override suspend fun bulk(action: BulkAction, ids: List<String>, tags: List<String>, folderId: String?): BulkResult = edits.withLock {
        val change = action.perCardChange()
        val batches = ids.distinct().chunked(MAX_BULK_CARD_IDS)
        val updated = mutableListOf<String>()
        val failed = mutableListOf<String>()
        for ((index, batch) in batches.withIndex()) {
            if (change != null && mustQueue()) {
                return@withLock queueBulk(change, batches.drop(index).flatten(), updated, failed)
            }
            val args = buildMap<String, Any?> {
                put("cardIds", batch)
                put("action", action.wireName)
                if (action == BulkAction.AddTags) put("tags", tags)
                folderId?.let { put("folderId", it) }
            }
            val result = try {
                convex.mutation(ConvexFunctions.bulkUpdateCards, args)
            } catch (e: TeakException) {
                if (change == null || !e.isOffline) throw e
                return@withLock queueBulk(change, batches.drop(index).flatten(), updated, failed)
            }
            updated += result.updatedIds
            failed += result.failedIds
        }
        BulkResult(updated, failed)
    }

    /** Offline, an action that changes each card on its own waits as one edit per card. */
    private suspend fun queueBulk(change: CardFieldChange, ids: List<String>, updated: List<String>, failed: List<String>): BulkResult {
        outbox.add(ids.map { OutboxItem.Edit(OutboxItem.newId(), it, change) })
        return BulkResult(updated + ids, failed)
    }

    override suspend fun refresh(id: String): RefreshOutcome {
        val result = convex.mutation(ConvexFunctions.reprocessCard, mapOf("cardId" to id))
        val status = (result["status"] as? JsonPrimitive)?.contentOrNull
        if (status == "queued") return RefreshOutcome.Queued
        val message = (result["message"] as? JsonPrimitive)?.contentOrNull
        return RefreshOutcome.Refused(message)
    }

    override suspend fun apply(id: String, changes: List<CardFieldChange>) = edits.withLock {
        if (mustQueue()) return@withLock queue(id, changes)
        for ((index, change) in changes.withIndex()) {
            try {
                convex.mutation(ConvexFunctions.updateCardField, change.args(id))
            } catch (e: TeakException) {
                if (!e.isOffline) throw e
                return@withLock queue(id, changes.drop(index))
            }
        }
    }

    private suspend fun queue(id: String, changes: List<CardFieldChange>) =
        outbox.add(changes.map { OutboxItem.Edit(OutboxItem.newId(), id, it) })

    /**
     * Text waits only when the socket is down before it's sent. Making a card isn't safe to send twice, so one whose
     * connection drops mid-call fails as offline instead of waiting: the server may already have saved it.
     */
    override suspend fun createFromText(text: String): String? {
        if (convex.connectedNow) return convex.mutation(ConvexFunctions.createCard, textCardArgs(text))
        outbox.add(listOf(OutboxItem.CreateText(OutboxItem.newId(), text)))
        return null
    }

    /**
     * An edit waits when the socket is down, as it's sent the moment it's back, and behind an edit that's still
     * waiting, so the server gets them in the order they were made.
     */
    private suspend fun mustQueue(): Boolean = !convex.connectedNow || outbox.hasPending()

    /** Edits go one at a time, so two made together reach the server, or the outbox, in the order they were made. */
    private val edits = Mutex()

    override val keptOffline: Flow<Set<String>> = copies.kept

    override suspend fun keepOffline(card: Card) = copies.keep(card)

    override suspend fun removeOfflineCopy(id: String) = copies.remove(id)

    override fun offlineFile(id: String): File? = copies.file(id)

    override val offlineChanges: Flow<Long> = copies.changes

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

    private fun now(): Double = System.currentTimeMillis().toDouble()

    private fun CardSummaryPage.withPending(pending: Map<String, List<CardFieldChange>>, filters: LibraryFilters): CardSummaryPage {
        if (pending.isEmpty()) return this
        val now = now()
        return copy(
            page = page.mapNotNull { summary ->
                val changes = pending[summary.id] ?: return@mapNotNull summary
                if (PendingEdits.keepsInView(changes, filters)) PendingEdits.apply(summary, changes, now) else null
            },
        )
    }
}

/** `cards:createCard`'s arguments for typed or shared text: a link when it's just an address, a note otherwise. */
internal fun textCardArgs(text: String): Map<String, Any?> {
    val resolved = LinkDetection.resolve(text)
    return buildMap {
        put("content", resolved.content)
        put("source", CARD_SOURCE)
        if (resolved.type == CardType.Link) {
            put("type", CardType.Link.wireName)
            put("url", resolved.url)
        }
    }
}

/** The single-card edit a bulk action makes on each card, when it makes the same one on every card. */
private fun BulkAction.perCardChange(): CardFieldChange? = when (this) {
    BulkAction.Favorite -> CardFieldChange.Favorite(true)
    BulkAction.Unfavorite -> CardFieldChange.Favorite(false)
    BulkAction.Archive -> CardFieldChange.Archive(true)
    BulkAction.Unarchive -> CardFieldChange.Archive(false)
    BulkAction.Delete -> CardFieldChange.MoveToTrash
    BulkAction.Restore -> CardFieldChange.Restore
    BulkAction.AddTags, BulkAction.AddToFolder -> null
}
