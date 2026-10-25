package com.praveenjuge.teak.core.model

import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import java.util.TimeZone
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Mirrors `packages/convex/__tests__/shared/linkCategories.test.ts`, `price.test.ts` (formatLinkPrice),
 * `tags.test.ts` (names and hidden tags) and `apps/web/src/lib/__tests__/exif.test.ts`.
 */
class LinkStateTest {
    @Test
    fun `done verbs follow the category`() {
        val cases = listOf("movie" to "watched", "game" to "played", "a-category-from-the-future" to "done", null to "done", "" to "done")
        for ((category, verb) in cases) assertEquals(verb, LinkState.doneVerb(category), "$category")
    }

    @Test
    fun `every known category gets its own verb, like doneActionLabel`() {
        assertEquals(UiText.of("native.done.markAs.read"), LinkState.toggleText("article", isDone = false))
        assertEquals(UiText.of("native.done.state.watched"), LinkState.toggleText("movie", isDone = true))
        assertEquals(UiText.of("native.done.markAs.read"), LinkState.toggleText("research", isDone = false))
        assertEquals(UiText.of("native.done.markedAs.read"), LinkState.toggledText("research", isDone = true))
        assertEquals(UiText.of("native.done.markAs.done"), LinkState.toggleText("a-category-from-the-future", isDone = false))
        assertEquals(UiText.of("native.done.markAs.done"), LinkState.toggleText(null, isDone = false))
        assertEquals(UiText.of("native.done.state.done"), LinkState.toggleText("repo", isDone = true))
        assertEquals(UiText.of("native.done.markedAsNot.read"), LinkState.toggledText("book", isDone = false))
        assertEquals("Marked as not read", LinkState.toggledMessage("book", isDone = false))
        assertTrue(LinkState.isActionable("product"))
        assertFalse(LinkState.isActionable("repo"))
    }

    /** Apple's TeakCoreTests check the same: a new verb needs its own catalog keys. */
    @Test
    fun `every done verb has its own sentences`() {
        for (verb in LINK_CATEGORY_DONE_VERBS.values.toSet()) {
            val words = assertNotNull(LinkState.words(verb), verb)
            val keys = listOf(words.markAs, words.markAsNot, words.state, words.markedAs, words.markedAsNot)
                .map { (it as UiText.Message).key }
            assertEquals(
                listOf("markAs", "markAsNot", "state", "markedAs", "markedAsNot").map { "native.done.$it.$verb" },
                keys,
                verb,
            )
        }
    }

    @Test
    fun `formats link prices`() {
        val cases = listOf(
            LinkPrice(24.99, "USD") to "$24.99",
            LinkPrice(1299.0, "EUR") to "€1,299.00",
            LinkPrice(1_299_999.0, "JPY") to "¥1,299,999",
            LinkPrice(0.0, "USD") to "Free",
            LinkPrice(12.5) to "12.5",
            LinkPrice(12.0, "ZZZZ") to "12",
        )
        for ((price, label) in cases) assertEquals(label, LinkState.formatPrice(price, Locale.US), "$price")
        assertEquals(UiText.of("native.details.free"), LinkState.priceText(LinkPrice(0.0, "USD"), Locale.US))
        val euros = LinkState.priceText(LinkPrice(1299.0, "EUR"), Locale.GERMANY)
        assertTrue((euros as UiText.Verbatim).text.contains("1.299,00"), "$euros")
    }

    @Test
    fun `tag names must be non-empty and at most 64 characters`() {
        assertEquals("design", Tags.key("  Design "))
        assertEquals("Name the tag", Tags.explainInvalidName(" "))
        assertNull(Tags.explainInvalidName("x".repeat(64)))
        assertEquals("Tags can be at most 64 characters", Tags.explainInvalidName("x".repeat(65)))
        assertEquals("A tag named \"web\" already exists. Merge into it instead.", Tags.existsMessage(" web "))
    }

    @Test
    fun `hidden tags hide a card`() {
        val cases = listOf(
            listOf("secret") to true,
            listOf("Secret") to true,
            listOf(" HIDDEN ") to true,
            listOf("work", "  hidden") to true,
            listOf("secrets", "hidden-ish", "hide") to false,
            emptyList<String>() to false,
            null to false,
        )
        for ((tags, hidden) in cases) assertEquals(hidden, Tags.isHiddenList(tags), "$tags")
    }

    @Test
    fun `adding a hidden tag explains how to find the card, once`() {
        assertEquals("Hidden. Search #secret to see it.", Tags.hiddenHint(listOf("work"), "Secret"))
        assertEquals(UiText.of("native.tags.card.hiddenAdded", "secret"), Tags.hiddenHintText(listOf("work"), "Secret"))
        assertNull(Tags.hiddenHintText(listOf("hidden"), "secret"))
        assertNull(Tags.hiddenHint(listOf("hidden"), "secret"))
        assertNull(Tags.hiddenHint(emptyList(), "work"))
    }

    @Test
    fun `lists a photo's facts in reading order`() {
        val rows = Exif.rows(
            ImageExif(
                exposureTime = 1 / 250.0,
                fNumber = 1.8,
                focalLength = 50.0,
                iso = 400.0,
                make = "Canon",
                model = "Canon EOS R5",
                takenAtClock = java.time.Instant.parse("2026-05-17T09:00:05Z").toEpochMilli().toDouble(),
            ),
        )
        assertEquals(
            listOf("camera", "taken", "exposure", "aperture", "focalLength", "iso").map { UiText.of("native.details.$it") },
            rows.map { it.label },
        )
        assertEquals(
            listOf("Canon EOS R5", "May 17, 2026, 09:00 AM", "1/250 s", "f/1.8", "50 mm", "400"),
            rows.map { it.text },
        )
    }

    // takenAtClock is the camera's clock time encoded as UTC. Read as an instant in a zone far from UTC,
    // it would move the hour and the date.
    @Test
    fun `shows the camera's clock time wherever it's viewed`() {
        val original = TimeZone.getDefault()
        fun taken(at: String, offset: Double? = null) =
            Exif.rows(ImageExif(takenAtClock = Instant.parse(at).toEpochMilli().toDouble(), takenAtOffset = offset)).single().text
        try {
            for (zone in listOf("America/Los_Angeles", "Pacific/Auckland")) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone))
                assertEquals("May 17, 2026, 09:00 AM", taken("2026-05-17T09:00:05Z"), zone)
                assertEquals("May 17, 2026, 12:30 AM", taken("2026-05-17T00:30:00Z"), zone)
                assertEquals("May 17, 2026, 11:45 PM", taken("2026-05-17T23:45:00Z"), zone)
                assertEquals("May 17, 2026, 09:00 AM UTC+5:30", taken("2026-05-17T09:00:00Z", 330.0), zone)
                assertEquals("May 17, 2026, 09:00 AM UTC-8", taken("2026-05-17T09:00:00Z", -480.0), zone)
                assertEquals("May 17, 2026, 09:00 AM UTC-9:30", taken("2026-05-17T09:00:00Z", -570.0), zone)
                assertEquals("May 17, 2026, 09:00 AM UTC", taken("2026-05-17T09:00:00Z", 0.0), zone)
                for (bad in listOf(Double.NaN, 5.5, 900.0, -900.0)) {
                    assertEquals("May 17, 2026, 09:00 AM", taken("2026-05-17T09:00:00Z", bad), "$zone $bad")
                }
            }
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun `prefers the clock time and reads older photos in the viewer's zone as before`() {
        val nine = Instant.parse("2026-05-17T09:00:00Z").toEpochMilli().toDouble()
        val earlier = Instant.parse("2026-05-17T03:30:00Z").toEpochMilli().toDouble()
        val la = ZoneId.of("America/Los_Angeles")
        assertEquals(
            "May 17, 2026, 09:00 AM UTC+5:30",
            Exif.rows(ImageExif(takenAt = earlier, takenAtClock = nine, takenAtOffset = 330.0), la).single().text,
        )
        assertEquals("May 17, 2026, 02:00 AM", Exif.rows(ImageExif(takenAt = nine), la).single().text)
    }

    @Test
    fun `never shows GPS and drops invalid facts`() {
        assertEquals(emptyList(), Exif.rows(ImageExif(latitude = 48.8584, longitude = 2.2945)))
        assertEquals(emptyList(), Exif.rows(null))
        assertEquals(emptyList(), Exif.rows(ImageExif(exposureTime = 0.0, fNumber = -2.0, focalLength = Double.NaN, iso = Double.POSITIVE_INFINITY)))
        assertEquals(emptyList(), Exif.rows(ImageExif(make = "   ", model = "")))
        assertEquals(listOf(DetailRow(UiText.of("native.details.aperture"), "f/8"), DetailRow(UiText.of("native.details.focalLength"), "24 mm")), Exif.rows(ImageExif(fNumber = 8.0, focalLength = 23.99)))
    }

    @Test
    fun `names the camera without repeating the make`() {
        val cases = listOf(
            Triple("Apple", "iPhone 17 Pro", "Apple iPhone 17 Pro"),
            Triple("Canon", "Canon EOS R5", "Canon EOS R5"),
            Triple("NIKON CORPORATION", "NIKON Z 8", "NIKON Z 8"),
            Triple("  FUJIFILM ", "  X-T5  ", "FUJIFILM X-T5"),
            Triple("Sony", null, "Sony"),
            Triple(null, "Pixel 9", "Pixel 9"),
        )
        for ((make, model, expected) in cases) assertEquals(expected, Exif.formatCamera(make, model))
        assertNull(Exif.formatCamera(null, " "))
    }

    @Test
    fun `writes exposure times like a camera`() {
        val cases = listOf(
            1 / 4000.0 to "1/4000 s", 1 / 60.0 to "1/60 s", 1 / 4.0 to "1/4 s", 0.3 to "0.3 s", 1 / 3.0 to "0.3 s",
            0.4 to "0.4 s", 0.6 to "0.6 s", 0.8 to "0.8 s", 1.0 to "1 s", 2.5 to "2.5 s", 30.0 to "30 s",
        )
        for ((seconds, label) in cases) assertEquals(label, Exif.formatExposureTime(seconds))
        for (seconds in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY, null)) assertNull(Exif.formatExposureTime(seconds))
    }
}

/** The text a detail row shows when it isn't a catalog message. */
internal val DetailRow.text: String get() = (value as UiText.Verbatim).text
