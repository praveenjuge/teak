package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CreatedAtRange
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.LinkDetection
import com.praveenjuge.teak.core.model.CardType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/** What the library is showing: search text, or a date range parsed from it, plus the chips. */
data class CardQuery(
    val search: String = "",
    val range: CreatedAtRange? = null,
    val filters: LibraryFilters = LibraryFilters.Empty,
)

interface CardsRepository {
    /** One live page of the library. Pass `null` for the first page, then each page's continueCursor. */
    fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>>

    /** The full card, or null when it's gone or belongs to someone else. */
    fun card(id: String): Flow<Result<Card?>>

    suspend fun setFavorite(id: String, favorite: Boolean)
    suspend fun moveToTrash(id: String)
    suspend fun restore(id: String)
    suspend fun deleteForever(id: String)

    /** Applies edits one at a time, in order, sending only the fields that changed. */
    suspend fun apply(id: String, changes: List<CardFieldChange>)

    /** Saves a note or link from typed or shared text. Returns the new card's ID. */
    suspend fun createFromText(text: String): String
}

@Singleton
class ConvexCardsRepository @Inject constructor(
    private val convex: ConvexApi,
) : CardsRepository {
    override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
        val args = buildMap<String, Any?> {
            put("paginationOpts", mapOf("numItems" to numItems.toDouble(), "cursor" to cursor))
            putAll(query.filters.toSearchArgs())
            val range = query.range
            if (range != null) {
                put("createdAtRange", mapOf("start" to range.start.toDouble(), "end" to range.end.toDouble()))
            } else if (query.search.isNotBlank()) {
                put("searchQuery", query.search.trim())
            }
        }
        return convex.subscribe("cards:searchMobileCardSummariesPaginated", args).map { result ->
            result.mapCatching { teakJson.decodeFromJsonElement(CardSummaryPage.serializer(), it) }
        }
    }

    override fun card(id: String): Flow<Result<Card?>> =
        convex.subscribe("cards:getCard", mapOf("id" to id)).map { result ->
            result.mapCatching { teakJson.decodeFromJsonElement(Card.serializer().nullable, it) }
        }

    override suspend fun setFavorite(id: String, favorite: Boolean) =
        update(id, "isFavorited", value = favorite)

    override suspend fun moveToTrash(id: String) = update(id, "delete")

    override suspend fun restore(id: String) = update(id, "restore")

    override suspend fun deleteForever(id: String) {
        convex.mutation("cards:permanentDeleteCard", mapOf("id" to id))
    }

    override suspend fun apply(id: String, changes: List<CardFieldChange>) {
        for (change in changes) {
            when (change) {
                is CardFieldChange.Content -> update(id, "content", value = change.value)
                is CardFieldChange.Notes -> update(id, "notes", value = change.value, sendNull = true)
                is CardFieldChange.Tags -> update(id, "tags", value = change.value)
                is CardFieldChange.RemoveAiTag -> convex.mutation(
                    "cards:updateCardField",
                    mapOf("cardId" to id, "field" to "removeAiTag", "tagToRemove" to change.tag),
                )
            }
        }
    }

    override suspend fun createFromText(text: String): String {
        val resolved = LinkDetection.resolve(text)
        val args = buildMap<String, Any?> {
            put("content", resolved.content)
            if (resolved.type == CardType.Link) {
                put("type", CardType.Link.wireName)
                put("url", resolved.url)
            }
        }
        return convex.mutation("cards:createCard", args).jsonPrimitive.content
    }

    private suspend fun update(id: String, field: String, value: Any? = null, sendNull: Boolean = false) {
        val args = buildMap<String, Any?> {
            put("cardId", id)
            put("field", field)
            if (value != null || sendNull) put("value", value)
        }
        convex.mutation("cards:updateCardField", args)
    }
}
