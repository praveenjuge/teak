package com.praveenjuge.teak.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Where a text card came from: "From example.com", linking to [url]. */
data class CardSource(val host: String, val url: String, val title: String?)

/** Detail rows the web shows beyond the basics: price, source, published date and camera facts. */
object CardDetails {
    private const val EARLIEST_PUBLISHED_YEAR = 1990
    private const val FUTURE_TOLERANCE_MS = 36L * 60 * 60 * 1000
    private val DISPLAY = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US).withZone(ZoneOffset.UTC)

    private fun parseInstant(value: String): Instant? {
        val parsers: List<(String) -> Instant> = listOf(
            { Instant.parse(it) },
            { OffsetDateTime.parse(it).toInstant() },
            { ZonedDateTime.parse(it, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant() },
            { LocalDateTime.parse(it).toInstant(ZoneOffset.UTC) },
            { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant() },
        )
        return parsers.firstNotNullOfOrNull { parse -> runCatching { parse(value) }.getOrNull() }
    }

    /** "Mar 5, 2024" in UTC, or null for a missing, unreadable, pre-1990 or future date (a port of `formatPublishedDate`). */
    fun publishedDate(value: String?, now: Long = System.currentTimeMillis()): String? {
        val trimmed = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val instant = parseInstant(trimmed) ?: return null
        if (instant.atZone(ZoneOffset.UTC).year < EARLIEST_PUBLISHED_YEAR || instant.toEpochMilli() > now + FUTURE_TOLERANCE_MS) return null
        return DISPLAY.format(instant)
    }

    /** The site a text or quote card was saved from, when its URL has a host. */
    fun source(card: Card): CardSource? {
        if (card.type != CardType.Text && card.type != CardType.Quote) return null
        val url = card.sourceUrl?.trim()?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: return null
        val host = UrlHost.normalize(url) ?: return null
        return CardSource(UrlHost.forDisplay(host), url, card.sourceTitle?.trim()?.takeIf(String::isNotEmpty))
    }

    fun extraRows(card: Card, now: Long = System.currentTimeMillis()): List<DetailRow> = buildList {
        val category = card.metadata?.linkCategory
        if (card.type == CardType.Link) {
            category?.price?.let { add(DetailRow("Price", LinkState.formatPrice(it))) }
            publishedDate(card.metadata?.linkPreview?.publishedAt, now)?.let { add(DetailRow("Published", it)) }
        }
        if (card.type == CardType.Image) addAll(Exif.rows(card.fileMetadata?.exif))
    }
}
