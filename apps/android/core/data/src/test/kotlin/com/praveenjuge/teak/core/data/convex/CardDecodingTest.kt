package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.Card
import org.junit.Test
import kotlin.test.assertEquals

class CardDecodingTest {
    @Test
    fun `a card marked done, in a category the app doesn't know, still decodes`() {
        val card = teakJson.decodeFromString<Card>(
            """
            {
              "_id": "card_1",
              "_creationTime": 1782000000000,
              "type": "link",
              "content": "https://example.com/game",
              "url": "https://example.com/game",
              "completedAt": 1782000500000,
              "metadata": {
                "linkCategory": {
                  "category": "a-category-from-the-future",
                  "fetchedAt": 1,
                  "sourceUrl": "https://example.com/game"
                }
              }
            }
            """.trimIndent(),
        )

        assertEquals("card_1", card.id)
        assertEquals("a-category-from-the-future", card.metadata?.linkCategory?.category)
    }
}
