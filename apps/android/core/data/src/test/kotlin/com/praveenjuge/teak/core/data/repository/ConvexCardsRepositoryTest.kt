package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.model.CardFieldChange
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
        assertEquals(mapOf("numItems" to 20.0, "cursor" to null), args["paginationOpts"])
        assertEquals(mapOf("start" to 10.0, "end" to 20.0), args["createdAtRange"])
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
            mapOf("content" to "https://teakvault.com", "type" to "link", "url" to "https://teakvault.com"),
            convex.calls.single().args,
        )
        repository.createFromText("just a note")
        assertEquals(mapOf("content" to "just a note"), convex.calls.last().args)
    }

    @Test
    fun `delete forever uses the id argument and trash uses updateCardField`() = runTest {
        repository.deleteForever("c1")
        repository.moveToTrash("c2")
        assertEquals("cards:permanentDeleteCard", convex.calls[0].name)
        assertEquals(mapOf("id" to "c1"), convex.calls[0].args)
        assertEquals(mapOf("cardId" to "c2", "field" to "delete"), convex.calls[1].args)
    }

}
