package com.praveenjuge.teak.core.model

import kotlin.math.abs
import kotlin.math.sin

/** Masonry layout rules shared with the iPhone grid (apps/mobile/lib/card-grid.ts). */
object CardGrid {
    const val GAP_DP = 12
    const val EDGE_DP = 16
    const val WAVEFORM_BAR_COUNT = 45
    private const val LINK_FALLBACK_RATIO = 1.91
    private const val MEDIA_FALLBACK_RATIO = 4.0 / 3.0
    private const val DOCUMENT_FALLBACK_RATIO = 3.0 / 4.0
    private const val FOOTER_HEIGHT = 44.0

    /** Two columns on phones, more as the window widens. Widths are in dp. */
    fun columnCount(widthDp: Float): Int = when {
        widthDp >= 1000 -> 4
        widthDp >= 700 -> 3
        else -> 2
    }

    fun tileImageUrl(card: CardSummary): String? = when (card.type) {
        CardType.Link -> card.linkPreviewImageUrl ?: card.screenshotUrl
        CardType.Image -> card.compactUrl ?: card.thumbnailUrl
        CardType.Video, CardType.Document -> card.thumbnailUrl ?: card.compactUrl
        else -> null
    }

    /** Width / height for a tile's media; extreme panoramas are clamped so tiles stay usable. */
    fun tileImageRatio(card: CardSummary): Double {
        val ratio = card.aspectRatio
        if (ratio != null && ratio > 0) return ratio.coerceIn(0.5, 2.5)
        return when (card.type) {
            CardType.Link -> LINK_FALLBACK_RATIO
            CardType.Document -> DOCUMENT_FALLBACK_RATIO
            else -> MEDIA_FALLBACK_RATIO
        }
    }

    /** Approximate tile height, used only to balance the columns. */
    fun estimateHeight(card: CardSummary, columnWidth: Double): Double {
        val media = if (tileImageUrl(card) != null) columnWidth / tileImageRatio(card) else 0.0
        return when (card.type) {
            CardType.Image, CardType.Video -> if (media > 0) media else columnWidth / MEDIA_FALLBACK_RATIO
            CardType.Link, CardType.Document -> media + FOOTER_HEIGHT + if (media > 0) 0.0 else 8.0
            CardType.Palette, CardType.Audio -> 56.0
            CardType.Quote -> 84.0
            CardType.Text -> 72.0
        }
    }

    /** Each item goes to the currently shortest column, so reading order runs left to right. */
    fun <T> distribute(items: List<T>, columns: Int, gap: Double = GAP_DP.toDouble(), estimate: (T) -> Double): List<List<T>> {
        val count = maxOf(1, columns)
        val result = List(count) { mutableListOf<T>() }
        val heights = DoubleArray(count)
        for (item in items) {
            var shortest = 0
            for (index in 1 until count) if (heights[index] < heights[shortest]) shortest = index
            result[shortest] += item
            heights[shortest] += estimate(item) + gap
        }
        return result
    }

    /** The web's 32-bit string hash waveform, so a recording looks the same everywhere. */
    fun waveformHeights(seed: String): List<Float> = List(WAVEFORM_BAR_COUNT) { index ->
        var hash = index
        for (char in seed) {
            hash = (hash shl 5) - hash + char.code
        }
        (abs(sin(hash.toDouble())) * 0.6 + 0.2).toFloat()
    }
}
