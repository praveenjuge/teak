package com.praveenjuge.teak.core.model

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.roundToLong

data class DetailRow(val label: String, val value: String)

/** What sharing a card sends: text, a file to download first, or nothing. */
sealed interface ShareTarget {
    data object None : ShareTarget
    data class Text(val text: String, val subject: String? = null) : ShareTarget
    data class File(val url: String, val fileName: String, val mimeType: String?) : ShareTarget
}

/** The detail screen's formatting rules. Port of apps/mobile/lib/card-sheet.ts. */
object CardSheet {
    private val sizeUnits = listOf("B", "KB", "MB", "GB")

    fun formatFileSize(bytes: Double): String {
        if (!(bytes > 0)) return "0 B"
        val exponent = min(floor(ln(bytes) / ln(1024.0)).toInt(), sizeUnits.size - 1)
        val scaled = bytes / Math.pow(1024.0, exponent.toDouble())
        val rounded = if (exponent == 0) {
            scaled.roundToLong().toString()
        } else {
            val tenths = (scaled * 10).roundToLong() / 10.0
            if (tenths % 1.0 == 0.0) tenths.toLong().toString() else tenths.toString()
        }
        return "$rounded ${sizeUnits[exponent]}"
    }

    fun formatDuration(seconds: Double): String {
        val total = maxOf(0L, floor(seconds).toLong())
        return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
    }

    fun hostname(url: String?): String? = url?.let {
        runCatching { URI(it).host }.getOrNull()?.removePrefix("www.")?.takeIf(String::isNotEmpty)
    }

    private fun sanitizeFileName(name: String): String? {
        val trimmed = name.trim().replace(Regex("[/\\\\]+"), "_")
        return trimmed.takeUnless { it.isEmpty() || it == "." || it == ".." }
    }

    /** A safe filename for a download: the saved name, else the URL's last segment, else a generated one. */
    fun downloadFileName(url: String?, fallback: String?, extension: String? = null, now: Long = System.currentTimeMillis()): String {
        fallback?.let(::sanitizeFileName)?.let { return it }
        if (url != null) {
            val segment = runCatching { URI(url).rawPath }.getOrNull()
                ?.split('/')?.lastOrNull { it.isNotEmpty() }
            if (segment != null) {
                val decoded = runCatching { URLDecoder.decode(segment, StandardCharsets.UTF_8) }.getOrDefault(segment)
                val base = decoded.split('/').lastOrNull { it.isNotEmpty() } ?: decoded
                sanitizeFileName(base)?.let { return it }
            }
        }
        return "download-$now${extension?.let { ".$it" }.orEmpty()}"
    }

    /** "PDF · 12 slides"-style facts about a file, without the card type itself. */
    fun fileFacts(card: Card): List<String> {
        val file = card.fileMetadata ?: return emptyList()
        val preview = file.preview
        val facts = listOfNotNull(
            file.language,
            file.kind,
            preview?.slideCount?.let { "${it.toLong()} slides" },
            preview?.wordCount?.let { "%,d words".format(it.toLong()) },
            preview?.archiveFileCount?.let { "${it.toLong()} files" },
            preview?.archiveDirectoryCount?.let { "${it.toLong()} folders" },
        ).filter { it.isNotEmpty() }
        val typeLabel = card.type.label.lowercase()
        return facts.filter { it.lowercase() != typeLabel }
    }

    fun detailRows(card: Card): List<DetailRow> = buildList {
        add(DetailRow("Type", card.type.label))
        val file = card.fileMetadata
        if (card.type == CardType.Link) hostname(card.url)?.let { add(DetailRow("Website", it)) }
        file?.fileName?.let { add(DetailRow("File", it)) }
        file?.mimeType?.let { add(DetailRow("Format", it)) }
        file?.fileSize?.let { add(DetailRow("Size", formatFileSize(it))) }
        if (file?.width != null && file.height != null) {
            add(DetailRow("Dimensions", "${file.width.toLong()} × ${file.height.toLong()}"))
        }
        file?.duration?.let { add(DetailRow("Duration", formatDuration(it))) }
        fileFacts(card).takeIf { it.isNotEmpty() }?.let { add(DetailRow("Details", it.joinToString(" · "))) }
        card.metadataDescription?.trim()?.takeIf { it.isNotEmpty() }?.let { add(DetailRow("Description", it)) }
    }

    fun copyText(card: Card): String? {
        val content = card.content.trim()
        return when (card.type) {
            CardType.Link -> card.url?.trim()?.takeIf { it.isNotEmpty() } ?: content.ifEmpty { null }
            CardType.Palette -> card.colors.orEmpty().map { it.hex }.filter { it.isNotEmpty() }
                .takeIf { it.isNotEmpty() }?.joinToString(", ")
            else -> content.ifEmpty { null }
        }
    }

    fun shareTarget(card: Card): ShareTarget = when (card.type) {
        CardType.Link -> card.url?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { ShareTarget.Text(it, card.metadataTitle) } ?: ShareTarget.None
        CardType.Text, CardType.Quote -> card.content.trim().takeIf { it.isNotEmpty() }
            ?.let { ShareTarget.Text(it) } ?: ShareTarget.None
        CardType.Palette -> copyText(card)?.let { ShareTarget.Text(it) } ?: ShareTarget.None
        CardType.Image -> {
            // A thumbnail is still an image, so it's a fine share when the original is missing.
            // Fallback renditions are named from their own URL, not the original file name.
            val url = card.fileUrl ?: card.thumbnailUrl ?: card.screenshotUrl
            when {
                url == null -> ShareTarget.None
                url == card.fileUrl -> ShareTarget.File(url, downloadFileName(url, card.fileMetadata?.fileName), card.fileMetadata?.mimeType)
                else -> ShareTarget.File(url, downloadFileName(url, null), null)
            }
        }
        // Video, audio and documents share only the original file.
        else -> card.fileUrl?.let {
            ShareTarget.File(it, downloadFileName(it, card.fileMetadata?.fileName), card.fileMetadata?.mimeType)
        } ?: ShareTarget.None
    }

    /** The detail title: the saved title, the file name, or the card's type ("Palette", "Image"). */
    fun title(card: Card, fallback: String? = null): String = when (card.type) {
        CardType.Text -> "Note"
        CardType.Quote -> "Quote"
        else -> card.metadataTitle?.takeIf { it.isNotBlank() }
            ?: card.fileMetadata?.fileName?.takeIf { it.isNotBlank() }
            ?: fallback
            ?: card.type.label
    }

    /** Images: the best rendition first; the original only when the device can decode it. */
    fun imagePrimaryUrl(card: Card): String? {
        val name = card.fileMetadata?.fileName?.lowercase().orEmpty()
        val needsRendition = name.endsWith(".heic") || name.endsWith(".heif") || name.endsWith(".svg")
        return card.detailUrl ?: card.compactUrl ?: card.thumbnailUrl ?: card.fileUrl.takeUnless { needsRendition }
    }
}
