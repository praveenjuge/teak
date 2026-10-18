package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CreatedAtRange
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.LinkDetection
import com.praveenjuge.teak.core.model.CardType
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

internal const val CARD_SOURCE = "android"

data class CardQuery(
    val search: String = "",
    val range: CreatedAtRange? = null,
    val filters: LibraryFilters = LibraryFilters.Empty,
)

interface CardsRepository {
    fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>>

    /** The full card, or null when it's gone or belongs to someone else. */
    fun card(id: String): Flow<Result<Card?>>

    suspend fun setFavorite(id: String, favorite: Boolean)
    suspend fun moveToTrash(id: String)
    suspend fun restore(id: String)
    suspend fun deleteForever(id: String)

    suspend fun apply(id: String, changes: List<CardFieldChange>)

    suspend fun createFromText(text: String): String
}

@Singleton
class ConvexCardsRepository @Inject constructor(
    private val convex: ConvexApi,
) : CardsRepository {
    override fun page(query: CardQuery, cursor: String?, numItems: Int): Flow<Result<CardSummaryPage>> {
        val args = buildMap<String, Any?> {
            put("paginationOpts", mapOf("numItems" to numItems, "cursor" to cursor))
            putAll(query.filters.toSearchArgs())
            val range = query.range
            if (range != null) {
                put("createdAtRange", mapOf("start" to range.start, "end" to range.endExclusive))
            } else if (query.search.isNotBlank()) {
                put("searchQuery", query.search.trim())
            }
        }
        return convex.subscribe(ConvexFunctions.searchCardSummaries, args)
    }

    override fun card(id: String): Flow<Result<Card?>> =
        convex.subscribe(ConvexFunctions.getCard, mapOf("id" to id))

    override suspend fun setFavorite(id: String, favorite: Boolean) =
        update(id, "isFavorited", value = favorite)

    override suspend fun moveToTrash(id: String) = update(id, "delete")

    override suspend fun restore(id: String) = update(id, "restore")

    override suspend fun deleteForever(id: String) {
        convex.mutation(ConvexFunctions.permanentDeleteCard, mapOf("id" to id))
    }

    override suspend fun apply(id: String, changes: List<CardFieldChange>) {
        for (change in changes) {
            when (change) {
                is CardFieldChange.Content -> update(id, "content", value = change.value)
                is CardFieldChange.Notes -> update(id, "notes", value = change.value, sendNull = true)
                is CardFieldChange.Tags -> update(id, "tags", value = change.value)
                is CardFieldChange.RemoveAiTag -> convex.mutation(
                    ConvexFunctions.updateCardField,
                    mapOf("cardId" to id, "field" to "removeAiTag", "tagToRemove" to change.tag),
                )
            }
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

    private suspend fun update(id: String, field: String, value: Any? = null, sendNull: Boolean = false) {
        val args = buildMap<String, Any?> {
            put("cardId", id)
            put("field", field)
            if (value != null || sendNull) put("value", value)
        }
        convex.mutation(ConvexFunctions.updateCardField, args)
    }
}
