package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.FakeOfflineCopies
import com.praveenjuge.teak.core.data.FakeOutbox
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.offline.OutboxItem
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardFieldChange
import com.praveenjuge.teak.core.model.LinkPrice
import com.praveenjuge.teak.core.model.RefreshOutcome
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.CreatedAtRange
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.TrashCount
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConvexCardsRepositoryTest {
    private val convex = FakeConvexApi()
    private val outbox = FakeOutbox()
    private val copies = FakeOfflineCopies()
    private val repository = ConvexCardsRepository(convex, outbox, copies)

    @Test
    fun `a date search sends the range and the words beside it, with float64 numbers`() = runTest {
        convex.responses["cards:searchMobileCardSummariesPaginated"] = {
            buildJsonObject {
                put("page", buildJsonArray {})
                put("isDone", true)
                put("continueCursor", "")
            }
        }
        repository.page(
            CardQuery(search = "figma", range = CreatedAtRange(10, 20), filters = LibraryFilters(favoritesOnly = true)),
            cursor = null,
            numItems = 20,
        ).first()
        val args = convex.calls.single().args
        assertEquals(mapOf("numItems" to 20, "cursor" to null), args["paginationOpts"])
        assertEquals(mapOf("start" to 10L, "end" to 20L), args["createdAtRange"])
        assertEquals("figma", args["searchQuery"])
        assertEquals(true, args["favoritesOnly"])

        repository.page(CardQuery(range = CreatedAtRange(10, 20)), cursor = null, numItems = 20).first()
        assertFalse("searchQuery" in convex.calls.last().args)
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
            listOf(
                CardFieldChange.Notes(null),
                CardFieldChange.Tags(listOf("a")),
                CardFieldChange.RemoveAiTag("Color"),
                CardFieldChange.AddColor("#FF5500"),
                CardFieldChange.RemoveColor("#4ECDC4"),
            ),
        )
        assertEquals(
            listOf(
                mapOf("cardId" to "c1", "field" to "notes", "value" to null),
                mapOf("cardId" to "c1", "field" to "tags", "value" to listOf("a")),
                mapOf("cardId" to "c1", "field" to "removeAiTag", "tagToRemove" to "Color"),
                mapOf("cardId" to "c1", "field" to "addColor", "value" to "#FF5500"),
                mapOf("cardId" to "c1", "field" to "removeColor", "value" to "#4ECDC4"),
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
    fun `empty trash takes no arguments and reports how many cards it deletes`() = runTest {
        convex.responses["cards:emptyTrash"] = { buildJsonObject { put("count", 3.0); put("more", false) } }
        assertEquals(TrashCount(3.0), repository.emptyTrash())
        assertEquals("cards:emptyTrash", convex.calls.single().name)
        assertEquals(emptyMap(), convex.calls.single().args)
    }

    @Test
    fun `trash count follows cards trashCount`() = runTest {
        convex.responses["cards:trashCount"] = { buildJsonObject { put("count", 40.0); put("more", true) } }
        assertEquals(TrashCount(40.0, more = true), repository.trashCount().first().getOrThrow())
        assertEquals("cards:trashCount", convex.calls.single().name)
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

    @Test
    fun `offline, an edit waits in the outbox and the card shows it`() = runTest {
        convex.responses["cards:getCard"] = { note("c1") }
        convex.offline = true

        repository.setFavorite("c1", true)
        repository.apply("c1", listOf(CardFieldChange.Content("Offline draft")))

        assertEquals(
            listOf(CardFieldChange.Favorite(true), CardFieldChange.Content("Offline draft")),
            outbox.items.value.map { (it as OutboxItem.Edit).change },
        )
        val card = repository.card("c1").first().getOrThrow()!!
        assertEquals(true, card.favorited)
        assertEquals("Offline draft", card.content)
    }

    @Test
    fun `a new edit waits behind ones still in the outbox, so they reach the server in order`() = runTest {
        outbox.add(listOf(OutboxItem.Edit("e1", "c1", CardFieldChange.Archive(true))))

        repository.setArchived("c1", false)

        assertTrue(convex.calls.isEmpty())
        assertEquals(listOf(CardFieldChange.Archive(true), CardFieldChange.Archive(false)), outbox.pendingEdits.value["c1"])
    }

    @Test
    fun `a waiting edit takes a card out of a view it no longer belongs in`() = runTest {
        convex.responses["cards:searchMobileCardSummariesPaginated"] = {
            buildJsonObject {
                put("page", buildJsonArray {
                    add(summary("c1"))
                    add(summary("c2"))
                })
                put("isDone", true)
            }
        }
        outbox.add(
            listOf(
                OutboxItem.Edit("e1", "c1", CardFieldChange.MoveToTrash),
                OutboxItem.Edit("e2", "c2", CardFieldChange.Favorite(true)),
            ),
        )

        val page = repository.page(CardQuery(), null, 20).first().getOrThrow().page

        assertEquals(listOf("c2"), page.map { it.id })
        assertEquals(true, page.single().isFavorited)
    }

    @Test
    fun `offline, a bulk archive waits as one edit per card and adding tags fails`() = runTest {
        convex.offline = true

        val result = repository.bulk(BulkAction.Archive, listOf("c1", "c2"))

        assertEquals(listOf("c1", "c2"), result.updatedIds)
        assertEquals(setOf("c1", "c2"), outbox.pendingEdits.value.keys)
        val failure = assertFailsWith<TeakException> { repository.bulk(BulkAction.AddTags, listOf("c1"), tags = listOf("a")) }
        assertEquals(TeakException.OFFLINE, failure.code)
    }

    @Test
    fun `offline, saved text waits and has no card id yet`() = runTest {
        convex.offline = true

        assertNull(repository.createFromText("https://example.com"))
        assertEquals(listOf("https://example.com"), outbox.items.value.map { (it as OutboxItem.CreateText).text })
    }

    @Test
    fun `a save whose connection drops mid-call fails instead of waiting, as the server may have it`() = runTest {
        convex.dropsMidCall = true

        val failure = assertFailsWith<TeakException> { repository.createFromText("Note") }

        assertEquals(TeakException.OFFLINE, failure.code)
        assertTrue(outbox.items.value.isEmpty())
    }

    @Test
    fun `a kept card shows before the server answers, and the server's copy replaces it`() = runTest {
        copies.keep(teakJson.decodeFromJsonElement(Card.serializer(), note("c1", content = "Kept")))
        convex.responses["cards:getCard"] = { note("c1", content = "Live") }

        val shown = repository.card("c1").take(2).toList().map { it.getOrThrow()?.content }

        assertEquals(listOf("Kept", "Live"), shown)
        assertEquals("Live", copies.card("c1")?.content)
    }

    @Test
    fun `a kept card the server says is gone, or that's deleted forever, loses its copy`() = runTest {
        copies.keep(teakJson.decodeFromJsonElement(Card.serializer(), note("c1")))
        copies.keep(teakJson.decodeFromJsonElement(Card.serializer(), note("c2")))
        copies.keep(teakJson.decodeFromJsonElement(Card.serializer(), note("c3")).copy(isDeleted = true))
        convex.responses["cards:getCard"] = { kotlinx.serialization.json.JsonNull }
        convex.responses["cards:emptyTrash"] = { buildJsonObject { put("count", 1.0) } }

        repository.card("c1").take(2).toList()
        repository.deleteForever("c2")
        repository.emptyTrash()

        assertTrue(copies.kept.value.isEmpty())
    }

    private fun note(id: String, content: String = "Note") = buildJsonObject {
        put("_id", id)
        put("_creationTime", 1.0)
        put("type", "text")
        put("content", content)
    }

    private fun summary(id: String) = buildJsonObject {
        put("_id", id)
        put("_creationTime", 1.0)
        put("type", "text")
        put("title", id)
    }
}
