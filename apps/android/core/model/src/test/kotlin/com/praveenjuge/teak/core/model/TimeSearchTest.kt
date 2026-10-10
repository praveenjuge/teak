package com.praveenjuge.teak.core.model

import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TimeSearchTest {
    private val zone = ZoneId.of("America/New_York")
    private val now = ZonedDateTime.of(2026, 2, 3, 12, 0, 0, 0, zone) // Tuesday, Feb 3, 2026

    private fun day(millis: Long) = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    private fun assertRange(query: String, label: String, start: LocalDate, end: LocalDate) {
        val result = TimeSearch.parse(query, now)!!
        assertEquals(label, result.label, query)
        assertEquals(start, day(result.range.start), query)
        assertEquals(end, day(result.range.end), query)
    }

    @Test
    fun `parses relative days and weeks`() {
        assertRange("today", "Today", LocalDate.of(2026, 2, 3), LocalDate.of(2026, 2, 4))
        assertRange("yesterday", "Yesterday", LocalDate.of(2026, 2, 2), LocalDate.of(2026, 2, 3))
        assertRange("last week", "Last Week", LocalDate.of(2026, 1, 25), LocalDate.of(2026, 2, 1))
        assertRange("Last  Month", "Last Month", LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1))
    }

    @Test
    fun `parses weekdays`() {
        assertRange("monday", "Monday", LocalDate.of(2026, 2, 2), LocalDate.of(2026, 2, 3))
        assertRange("last monday", "Last Monday", LocalDate.of(2026, 1, 26), LocalDate.of(2026, 1, 27))
    }

    @Test
    fun `parses explicit dates, months and years`() {
        assertRange("June 2024", "Jun 2024", LocalDate.of(2024, 6, 1), LocalDate.of(2024, 7, 1))
        assertRange("June 5, 2024", "Jun 5, 2024", LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("2024-06-05", "Jun 5, 2024", LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("06/05/2024", "Jun 5, 2024", LocalDate.of(2024, 6, 5), LocalDate.of(2024, 6, 6))
        assertRange("2024", "2024", LocalDate.of(2024, 1, 1), LocalDate.of(2025, 1, 1))
    }

    @Test
    fun `parses ranges`() {
        assertRange("June 2024 to July 2025", "Jun 2024 – Jul 2025", LocalDate.of(2024, 6, 1), LocalDate.of(2025, 8, 1))
    }

    @Test
    fun `leaves other text and impossible dates to full-text search`() {
        assertNull(TimeSearch.parse("design inspiration", now))
        assertNull(TimeSearch.parse("2024-02-30", now))
        assertNull(TimeSearch.parse("July 2025 to June 2024", now))
    }
}
