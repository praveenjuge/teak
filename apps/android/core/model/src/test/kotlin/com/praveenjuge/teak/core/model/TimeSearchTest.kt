package com.praveenjuge.teak.core.model

import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TimeSearchTest {
    private val zone = ZoneId.of("America/New_York")
    private val tuesdayNoon = ZonedDateTime.of(2026, 2, 3, 12, 0, 0, 0, zone)

    private fun day(millis: Long) = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    private fun assertRange(query: String, label: UiText, start: LocalDate, end: LocalDate) {
        val result = TimeSearch.parse(query, tuesdayNoon, Locale.US)!!
        assertEquals(label, result.labelText, query)
        assertEquals(start, day(result.range.start), query)
        assertEquals(end, day(result.range.endExclusive), query)
    }

    @Test
    fun `parses relative days and weeks`() {
        assertRange("today", UiText.of("native.time.today"), LocalDate.of(2026, 2, 3), LocalDate.of(2026, 2, 4))
        assertRange("yesterday", UiText.of("native.time.yesterday"), LocalDate.of(2026, 2, 2), LocalDate.of(2026, 2, 3))
        assertRange("last week", UiText.of("native.time.lastWeek"), LocalDate.of(2026, 1, 25), LocalDate.of(2026, 2, 1))
        assertRange("Last  Month", UiText.of("native.time.lastMonth"), LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1))
    }

    @Test
    fun `parses weekdays`() {
        assertRange("monday", UiText.verbatim("Monday"), LocalDate.of(2026, 2, 2), LocalDate.of(2026, 2, 3))
        assertRange("last monday", UiText.of("native.time.lastWeekday", "Monday"), LocalDate.of(2026, 1, 26), LocalDate.of(2026, 1, 27))
    }

    @Test
    fun `parses explicit dates, months and years`() {
        assertRange("June 2024", UiText.verbatim("Jun 2024"), LocalDate.of(2024, 6, 1), LocalDate.of(2024, 7, 1))
        assertRange("June 5, 2024", UiText.verbatim("Jun 5, 2024"), LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("2024-06-05", UiText.verbatim("Jun 5, 2024"), LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("06/05/2024", UiText.verbatim("Jun 5, 2024"), LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("2024", UiText.verbatim("2024"), LocalDate.of(2024, 1, 1), LocalDate.of(2025, 1, 1))
    }

    @Test
    fun `parses ranges`() {
        assertRange(
            "June 2024 to July 2025",
            UiText.of("native.time.range", UiText.verbatim("Jun 2024"), UiText.verbatim("Jul 2025")),
            LocalDate.of(2024, 6, 1), LocalDate.of(2025, 8, 1))
    }

    @Test
    fun `labels follow the app's language`() {
        fun text(query: String, locale: Locale = Locale.US) = TimeSearch.parse(query, tuesdayNoon, locale)!!.labelText
        assertEquals(UiText.of("native.time.lastWeek"), text("last week"))
        assertEquals(UiText.of("native.time.lastWeekday", "Monday"), text("last monday"))
        assertEquals(UiText.verbatim("Montag"), text("monday", Locale.GERMANY))
        assertEquals(UiText.verbatim("05.06.2024"), text("2024-06-05", Locale.GERMANY))
        assertEquals(UiText.of("native.time.range", UiText.verbatim("Jun 2024"), UiText.verbatim("Jul 2025")), text("June 2024 to July 2025"))
    }

    @Test
    fun `leaves other text and impossible dates to full-text search`() {
        assertNull(TimeSearch.parse("design inspiration", tuesdayNoon))
        assertNull(TimeSearch.parse("2024-02-30", tuesdayNoon))
        assertNull(TimeSearch.parse("July 2025 to June 2024", tuesdayNoon))
        // A bare number is a year only from 1900 to ten years ahead, as `isSearchYear` decides.
        for (query in listOf("1234", "4096", "2037", "1899")) assertNull(TimeSearch.parse(query, tuesdayNoon), query)
        assertEquals(UiText.verbatim("1900"), TimeSearch.parse("1900", tuesdayNoon, Locale.US)?.labelText)
        assertEquals(UiText.verbatim("2036"), TimeSearch.parse("2036", tuesdayNoon, Locale.US)?.labelText)
        // Only ASCII digits are read: these stay text, as on the web.
        for (query in listOf("２０２４", "٢٠٢٤", "june ２０２４", "２０２４-０６-０５")) {
            assertNull(TimeSearch.parse(query, tuesdayNoon), query)
        }
    }
}
