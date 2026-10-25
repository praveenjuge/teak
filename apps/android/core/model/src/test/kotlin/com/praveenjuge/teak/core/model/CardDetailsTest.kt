package com.praveenjuge.teak.core.model

import org.junit.Test
import java.time.Instant
import java.util.Locale
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Mirrors `apps/web/src/lib/__tests__/linkByline.test.ts` (formatPublishedDate) and the web's detail rows. */
class CardDetailsTest {
    private val now = Instant.parse("2026-10-12T12:00:00Z").toEpochMilli()

    @Test
    fun `formats published dates in UTC`() {
        val cases = listOf(
            "2024-03-05" to "Mar 5, 2024",
            "2024-03-05T23:30:00-05:00" to "Mar 6, 2024",
            "Tue, 05 Mar 2024 10:00:00 GMT" to "Mar 5, 2024",
        )
        for ((value, expected) in cases) assertEquals(expected, CardDetails.publishedDate(value, now, Locale.US), value)
        assertEquals("05.03.2024", CardDetails.publishedDate("2024-03-05", now, Locale.GERMANY))
    }

    @Test
    fun `ignores unreadable, ancient and future dates`() {
        for (value in listOf("not a date", "", "1970-01-01T00:00:00Z", "2031-01-01", null)) {
            assertNull(CardDetails.publishedDate(value, now), "$value")
        }
    }

    private fun card(type: CardType, sourceUrl: String? = null) =
        Card(id = "c", creationTime = 0.0, type = type, sourceUrl = sourceUrl, sourceTitle = " A page ")

    @Test
    fun `a text card shows the site it came from`() {
        assertEquals(
            CardSource("example.com", "https://www.example.com/a", "A page"),
            CardDetails.source(card(CardType.Text, "https://www.example.com/a")),
        )
        assertNull(CardDetails.source(card(CardType.Text, "javascript:alert(1)")))
        assertNull(CardDetails.source(card(CardType.Link, "https://example.com")))
    }

    @Test
    fun `product links show their price and photos their camera`() {
        val product = card(CardType.Link).copy(
            metadata = CardMetadata(
                linkPreview = LinkPreview(publishedAt = "2024-03-05"),
                linkCategory = LinkCategory(category = "product", price = LinkPrice(24.99, "USD")),
            ),
        )
        assertEquals(listOf(UiText.of("native.details.price"), UiText.of("native.details.published")), CardDetails.extraRows(product, now).map { it.label })
        val photo = card(CardType.Image).copy(fileMetadata = FileMetadata(exif = ImageExif(iso = 100.0)))
        assertEquals(listOf(DetailRow(UiText.of("native.details.iso"), "100")), CardDetails.extraRows(photo, now))
    }
}
