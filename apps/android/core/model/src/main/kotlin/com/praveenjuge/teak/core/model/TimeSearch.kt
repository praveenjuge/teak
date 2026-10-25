package com.praveenjuge.teak.core.model

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

typealias EpochMillis = Long

data class CreatedAtRange(
    override val start: EpochMillis,
    override val endExclusive: EpochMillis,
) : OpenEndRange<EpochMillis>

/** [label] is English, for screens that haven't moved to [labelText], the label in the app's language. */
data class TimeFilter(val label: String, val range: CreatedAtRange, val labelText: UiText = UiText.verbatim(label))

/**
 * Turns searches like "last week", "monday", "June 2024" or "2024-06-05 to 2024-07-01" into a
 * created-at range, so the library filters by date instead of searching text. Port of
 * `parseTimeSearchQuery` in packages/convex/shared/utils/timeSearch.ts; weeks start on Sunday.
 * The words people type stay English; only the label follows the app's language.
 */
object TimeSearch {
    private data class DayRange(val start: LocalDate, val end: LocalDate, val label: String, val text: UiText)

    private val months = mapOf(
        "january" to 1, "jan" to 1, "february" to 2, "feb" to 2, "march" to 3, "mar" to 3,
        "april" to 4, "apr" to 4, "may" to 5, "june" to 6, "jun" to 6, "july" to 7, "jul" to 7,
        "august" to 8, "aug" to 8, "september" to 9, "sep" to 9, "sept" to 9, "october" to 10,
        "oct" to 10, "november" to 11, "nov" to 11, "december" to 12, "dec" to 12,
    )

    private val weekdays = mapOf(
        "sunday" to 0, "monday" to 1, "tuesday" to 2, "wednesday" to 3,
        "thursday" to 4, "friday" to 5, "saturday" to 6,
    )

    private val dayLabel = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val monthLabel = DateTimeFormatter.ofPattern("MMM yyyy", Locale.US)
    private val iso = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")
    private val us = Regex("^(\\d{1,2})/(\\d{1,2})/(\\d{4})$")
    private val monthDayYear = Regex("^([a-z]+)\\s+(\\d{1,2}),?\\s+(\\d{4})$")
    private val monthYear = Regex("^([a-z]+)\\s+(\\d{4})$")
    private val year = Regex("^(\\d{4})$")

    /** Sunday = 0, like JavaScript's `Date.getDay()`. */
    private fun LocalDate.weekdayIndex(): Int = dayOfWeek.value % 7

    private fun titleCase(value: String) =
        value.split(" ").joinToString(" ") { part -> part.replaceFirstChar { it.uppercase() } }

    private fun relative(query: String, today: LocalDate): DayRange? = when (query) {
        "today" -> DayRange(today, today.plusDays(1), "Today", UiText.of("native.time.today"))
        "yesterday" -> DayRange(today.minusDays(1), today, "Yesterday", UiText.of("native.time.yesterday"))
        "this week", "last week" -> {
            val startOfWeek = today.minusDays(today.weekdayIndex().toLong())
            if (query == "this week") {
                DayRange(startOfWeek, startOfWeek.plusDays(7), "This Week", UiText.of("native.time.thisWeek"))
            } else {
                DayRange(startOfWeek.minusDays(7), startOfWeek, "Last Week", UiText.of("native.time.lastWeek"))
            }
        }
        "this month", "last month" -> {
            val startOfMonth = today.withDayOfMonth(1)
            if (query == "this month") {
                DayRange(startOfMonth, startOfMonth.plusMonths(1), "This Month", UiText.of("native.time.thisMonth"))
            } else {
                DayRange(startOfMonth.minusMonths(1), startOfMonth, "Last Month", UiText.of("native.time.lastMonth"))
            }
        }
        "this year", "last year" -> {
            val startOfYear = today.withDayOfYear(1)
            if (query == "this year") {
                DayRange(startOfYear, startOfYear.plusYears(1), "This Year", UiText.of("native.time.thisYear"))
            } else {
                DayRange(startOfYear.minusYears(1), startOfYear, "Last Year", UiText.of("native.time.lastYear"))
            }
        }
        else -> null
    }

    private fun weekday(query: String, today: LocalDate, locale: Locale): DayRange? {
        val last = query.startsWith("last ")
        val token = if (last) query.removePrefix("last ").trimStart() else query
        val index = weekdays[token] ?: return null
        val diff = (today.weekdayIndex() - index + 7) % 7
        val mostRecent = today.minusDays(diff.toLong())
        val start = if (last) mostRecent.minusDays(7) else mostRecent
        val label = if (last) "Last ${titleCase(token)}" else titleCase(token)
        val name = start.dayOfWeek.getDisplayName(TextStyle.FULL_STANDALONE, locale)
        val text = if (last) UiText.of("native.time.lastWeekday", name) else UiText.verbatim(name)
        return DayRange(start, start.plusDays(1), label, text)
    }

    private fun dateOrNull(year: Int, month: Int, day: Int): LocalDate? =
        runCatching { LocalDate.of(year, month, day) }.getOrNull()

    private fun day(date: LocalDate, locale: Locale) = DayRange(
        date,
        date.plusDays(1),
        dayLabel.format(date),
        UiText.verbatim(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(date)),
    )

    private fun explicit(query: String, locale: Locale): DayRange? {
        iso.matchEntire(query)?.let { m ->
            val (y, mo, d) = m.destructured
            dateOrNull(y.toInt(), mo.toInt(), d.toInt())?.let { return day(it, locale) }
        }
        us.matchEntire(query)?.let { m ->
            val (mo, d, y) = m.destructured
            dateOrNull(y.toInt(), mo.toInt(), d.toInt())?.let { return day(it, locale) }
        }
        monthDayYear.matchEntire(query)?.let { m ->
            val (name, d, y) = m.destructured
            months[name]?.let { month -> dateOrNull(y.toInt(), month, d.toInt())?.let { return day(it, locale) } }
        }
        monthYear.matchEntire(query)?.let { m ->
            val (name, y) = m.destructured
            months[name]?.let { month ->
                val start = LocalDate.of(y.toInt(), month, 1)
                val text = DateTimeFormatter.ofPattern("MMM yyyy", locale).format(start)
                return DayRange(start, start.plusMonths(1), monthLabel.format(start), UiText.verbatim(text))
            }
        }
        year.matchEntire(query)?.let { m ->
            val start = LocalDate.of(m.groupValues[1].toInt(), 1, 1)
            return DayRange(start, start.plusYears(1), m.groupValues[1], UiText.verbatim(m.groupValues[1]))
        }
        return null
    }

    private fun single(query: String, today: LocalDate, locale: Locale): DayRange? =
        relative(query, today) ?: weekday(query, today, locale) ?: explicit(query, locale)

    fun parse(query: String, now: ZonedDateTime = ZonedDateTime.now(), locale: Locale = Locale.getDefault()): TimeFilter? {
        val normalized = query.trim().replace(Regex("\\s+"), " ").lowercase()
        if (normalized.isEmpty()) return null
        val zone = now.zone
        val today = now.toLocalDate()
        val input = normalized.take(200)
        val toIndex = input.indexOf(" to ")
        val dashIndex = input.indexOf(" - ")

        val split: Pair<String, String>? = when {
            input.startsWith("from ") && toIndex > 5 ->
                input.substring(5, toIndex).trim() to input.substring(toIndex + 4).trim()
            toIndex > 0 && !input.startsWith("from ") ->
                input.substring(0, toIndex).trim() to input.substring(toIndex + 4).trim()
            dashIndex > 0 -> input.substring(0, dashIndex).trim() to input.substring(dashIndex + 3).trim()
            else -> null
        }
        if (split != null) {
            val left = single(split.first, today, locale) ?: return null
            val right = single(split.second, today, locale) ?: return null
            if (!left.start.isBefore(right.end)) return null
            return TimeFilter(
                "${left.label} – ${right.label}",
                range(left.start, right.end, zone),
                UiText.of("native.time.range", left.text, right.text),
            )
        }
        val match = single(normalized, today, locale) ?: return null
        return TimeFilter(match.label, range(match.start, match.end, zone), match.text)
    }

    private fun range(start: LocalDate, end: LocalDate, zone: ZoneId) =
        CreatedAtRange(start.atStartOfDay(zone).toInstant().toEpochMilli(), end.atStartOfDay(zone).toInstant().toEpochMilli())
}
