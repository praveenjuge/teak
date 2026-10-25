package com.praveenjuge.teak.core.model

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.min
import kotlin.math.roundToLong

data class DetailRow(val label: UiText, val value: UiText) {
    constructor(label: UiText, value: String) : this(label, UiText.verbatim(value))
}

sealed interface ShareTarget {
    data object None : ShareTarget
    data class Text(val text: String, val subject: String? = null) : ShareTarget
    data class File(val url: String, val fileName: String, val mimeType: String?) : ShareTarget
}

object CardSheet {
    private val sizeUnits = listOf("B", "KB", "MB", "GB")

    fun formatFileSize(bytes: Double, locale: Locale = Locale.getDefault()): String {
        if (!(bytes > 0)) return "0 B"
        val exponent = min(floor(ln(bytes) / ln(1024.0)).toInt(), sizeUnits.size - 1)
        val scaled = bytes / Math.pow(1024.0, exponent.toDouble())
        val rounded = if (exponent == 0) scaled.roundToLong().toDouble() else (scaled * 10).roundToLong() / 10.0
        val number = NumberFormat.getNumberInstance(locale).apply {
            maximumFractionDigits = 1
            isGroupingUsed = false
        }.format(rounded)
        return "$number ${sizeUnits[exponent]}"
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

    fun downloadFileName(url: String?, savedName: String?, extension: String? = null, now: Long = System.currentTimeMillis()): String {
        savedName?.let(::sanitizeFileName)?.let { return it }
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

    /** A file's language and kind as the server writes them, then counts: "12 slides", "1 folder". */
    fun fileFacts(card: Card): List<UiText> {
        val file = card.fileMetadata ?: return emptyList()
        val preview = file.preview
        // The server writes `kind` in English, so it's compared with the type's English name.
        val written = listOfNotNull(file.language, file.kind).filter { it.isNotEmpty() && it.lowercase() != card.type.wireName }
        return written.map(UiText::verbatim) + listOfNotNull(
            preview?.slideCount?.let { UiText.of("native.details.slides", count = it.toInt()) },
            preview?.wordCount?.let { UiText.of("native.details.words", count = it.toInt()) },
            preview?.archiveFileCount?.let { UiText.of("native.details.files", count = it.toInt()) },
            preview?.archiveDirectoryCount?.let { UiText.of("native.details.folders", count = it.toInt()) },
        )
    }

    fun detailRows(card: Card, locale: Locale = Locale.getDefault()): List<DetailRow> = buildList {
        add(DetailRow(UiText.of("native.details.type"), card.type.labelText))
        val file = card.fileMetadata
        if (card.type == CardType.Link) hostname(card.url)?.let { add(DetailRow(UiText.of("native.details.website"), it)) }
        file?.fileName?.let { add(DetailRow(UiText.of("native.details.file"), it)) }
        file?.mimeType?.let { add(DetailRow(UiText.of("native.details.format"), it)) }
        file?.fileSize?.let { add(DetailRow(UiText.of("native.details.size"), formatFileSize(it, locale))) }
        if (file?.width != null && file.height != null) {
            add(DetailRow(UiText.of("native.details.dimensions"), "${file.width.toLong()} × ${file.height.toLong()}"))
        }
        file?.duration?.let { add(DetailRow(UiText.of("native.details.duration"), formatDuration(it))) }
        fileFacts(card).takeIf { it.isNotEmpty() }?.let { facts ->
            add(DetailRow(UiText.of("native.details.details"), facts.reduceRight { fact, rest -> UiText.of("native.details.list", fact, rest) }))
        }
        card.metadataDescription?.trim()?.takeIf { it.isNotEmpty() }?.let { add(DetailRow(UiText.of("native.details.description"), it)) }
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
            val url = card.fileUrl ?: card.thumbnailUrl ?: card.screenshotUrl
            when {
                url == null -> ShareTarget.None
                url == card.fileUrl -> ShareTarget.File(url, downloadFileName(url, card.fileMetadata?.fileName), card.fileMetadata?.mimeType)
                else -> ShareTarget.File(url, downloadFileName(url, null), null)
            }
        }
        else -> card.fileUrl?.let {
            ShareTarget.File(it, downloadFileName(it, card.fileMetadata?.fileName), card.fileMetadata?.mimeType)
        } ?: ShareTarget.None
    }

    fun title(card: Card, fallback: String? = null): UiText = when (card.type) {
        CardType.Text -> UiText.of("native.card.note")
        CardType.Quote -> UiText.of("cards.types.quote")
        else -> (card.metadataTitle?.takeIf { it.isNotBlank() } ?: card.fileMetadata?.fileName?.takeIf { it.isNotBlank() } ?: fallback)
            ?.let(UiText::verbatim)
            ?: card.type.labelText
    }

    fun imagePrimaryUrl(card: Card): String? {
        val name = card.fileMetadata?.fileName?.lowercase().orEmpty()
        val needsRendition = name.endsWith(".heic") || name.endsWith(".heif") || name.endsWith(".svg")
        return card.detailUrl ?: card.compactUrl ?: card.thumbnailUrl ?: card.fileUrl.takeUnless { needsRendition }
    }
}
