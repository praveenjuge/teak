package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.LinkPrice
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.CreatedAtRange
import com.praveenjuge.teak.core.model.LibraryFilters
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class ConvexCardsRepositoryTest {
    private val convex = FakeConvexApi()
    private val repository = ConvexCardsRepository(convex)

    @Test
    fun `a date search sends the range instead of text, with float64 numbers`() = runTest {
        convex.responses["cards:searchMobileCardSummariesPaginated"] = {
            buildJsonObject {
                put("page", buildJsonArray {})
                put("isDone", true)
                put("continueCursor", "")
            }
        }
        repository.page(
            CardQuery(search = "last week", range = CreatedAtRange(10, 20), filters = LibraryFilters(favoritesOnly = true)),
            cursor = null,
            numItems = 20,
        ).first()
        val args = convex.calls.single().args
        assertEquals(mapOf("numItems" to 20, "cursor" to null), args["paginationOpts"])
        assertEquals(mapOf("start" to 10L, "end" to 20L), args["createdAtRange"])
        assertFalse("searchQuery" in args)
        assertEquals(true, args["favoritesOnly"])
    }

    @Test
    fun `decodes summaries, ignoring fields the app doesn't use`() = runTest {
        convex.responses["cards:searchMobileCardSummariesPaginated"] = {
            buildJsonObject {
                put("page", buildJsonArray {
                    add(buildJsonObject {
                        put("_id", "c1")
                        put("_creationTime", 1.0)
                        put("type", "link")
                        put("title", "Example")
                        put("somethingNew", "ignored")
                    })
                })
                put("isDone", false)
                put("continueCursor", "abc")
            }
        }
        val page = repository.page(CardQuery(search = "design"), null, 20).first().getOrThrow()
        assertEquals(CardType.Link, page.page.single().type)
        assertEquals("abc", page.continueCursor)
        assertEquals("design", convex.calls.single().args["searchQuery"])
    }

    @Test
    fun `edits go out one field at a time, clearing notes with null`() = runTest {
        repository.apply(
            "c1",
            listOf(CardFieldChange.Notes(null), CardFieldChange.Tags(listOf("a")), CardFieldChange.RemoveAiTag("Color")),
        )
        assertEquals(
            listOf(
                mapOf("cardId" to "c1", "field" to "notes", "value" to null),
                mapOf("cardId" to "c1", "field" to "tags", "value" to listOf("a")),
                mapOf("cardId" to "c1", "field" to "removeAiTag", "tagToRemove" to "Color"),
            ),
            convex.calls.map { it.args },
        )
    }

    @Test
    fun `saving text with a link makes a link card`() = runTest {
        convex.responses["cards:createCard"] = { JsonPrimitive("new_card") }
        assertEquals("new_card", repository.createFromText("https://teakvault.com"))
        assertEquals(
            mapOf(
                "content" to "https://teakvault.com",
                "source" to "android",
                "type" to "link",
                "url" to "https://teakvault.com",
            ),
            convex.calls.single().args,
        )
        repository.createFromText("just a note")
        assertEquals(mapOf("content" to "just a note", "source" to "android"), convex.calls.last().args)
    }

    @Test
    fun `delete forever uses the id argument and trash uses updateCardField`() = runTest {
        repository.deleteForever("c1")
        repository.moveToTrash("c2")
        assertEquals("cards:permanentDeleteCard", convex.calls[0].name)
        assertEquals(mapOf("id" to "c1"), convex.calls[0].args)
        assertEquals(mapOf("cardId" to "c2", "field" to "delete"), convex.calls[1].args)
    }

    @Test
    fun `summaries carry archive, done, category and price`() = runTest {
        convex.responses["cards:searchMobileCardSummariesPaginated"] = {
            buildJsonObject {
                put("page", buildJsonArray {
                    add(buildJsonObject {
                        put("_id", "c1")
                        put("_creationTime", 1.0)
                        put("type", "link")
                        put("title", "Lamp")
                        put("isArchived", true)
                        put("completedAt", 5.0)
                        put("linkCategory", "product")
                        put("linkPrice", buildJsonObject {
                            put("amount", 24.99)
                            put("currency", "USD")
                        })
                    })
                })
                put("isDone", true)
                put("continueCursor", "")
            }
        }
        val card = repository.page(CardQuery(folderId = "f1", filters = LibraryFilters(archivedOnly = true)), null, 20)
            .first().getOrThrow().page.single()
        assertEquals(true, card.archived)
        assertEquals(true, card.isDone)
        assertEquals("product", card.linkCategory)
        assertEquals(LinkPrice(24.99, "USD"), card.linkPrice)
        val args = convex.calls.single().args
        assertEquals("f1", args["folderId"])
        assertEquals(true, args["showArchivedOnly"])
    }

    @Test
    fun `bulk actions go in batches of 100 and gather the failures`() = runTest {
        convex.responses["cards:bulkUpdateCards"] = { args ->
            @Suppress("UNCHECKED_CAST")
            val ids = args["cardIds"] as List<String>
            buildJsonObject {
                put("updatedIds", buildJsonArray { ids.drop(1).forEach { add(JsonPrimitive(it)) } })
                put("failedIds", buildJsonArray { add(JsonPrimitive(ids.first())) })
            }
        }
        val ids = (1..250).map { "c$it" }
        val result = repository.bulk(BulkAction.AddTags, ids, tags = listOf("design"))

        assertEquals(listOf(100, 100, 50), convex.calls.map { (it.args["cardIds"] as List<*>).size })
        assertEquals(listOf("c1", "c101", "c201"), result.failedIds)
        assertEquals(247, result.updatedIds.size)
        assertEquals(mapOf("action" to "addTags", "tags" to listOf("design")), convex.calls.first().args - "cardIds")
    }

    @Test
    fun `a refused refresh carries the server's reason`() = runTest {
        convex.responses["cards:reprocessCard"] = {
            buildJsonObject {
                put("status", "refused")
                put("code", "RATE_LIMITED")
                put("message", "This card is already refreshing. Try again in a minute.")
            }
        }
        assertEquals(
            RefreshOutcome.Refused("This card is already refreshing. Try again in a minute."),
            repository.refresh("c1"),
        )
        convex.responses["cards:reprocessCard"] = { buildJsonObject { put("status", "queued") } }
        assertEquals(RefreshOutcome.Queued, repository.refresh("c1"))
    }

    @Test
    fun `archive and done use their own fields`() = runTest {
        repository.setArchived("c1", true)
        repository.setArchived("c1", false)
        repository.setDone("c1", true)
        repository.setDone("c1", false)
        assertEquals(listOf("archive", "unarchive", "done", "undone"), convex.calls.map { it.args["field"] })
    }
}
