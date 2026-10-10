package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Preview
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardColor
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import kotlin.math.ceil

private val SWATCH_MIN_WIDTH = 84.dp
private val SWATCH_HEIGHT = 128.dp

/** The card itself, shown the way its type reads best. */
@Composable
internal fun CardPreview(
    card: Card,
    documentText: String?,
    onCopyColor: (String) -> Unit,
    onViewDocument: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val openImage = rememberImageViewer(CardSheet.title(card))
    val file = card.fileMetadata
    val ratio = mediaRatio(file?.width, file?.height)
    val content = card.content.trim()
    when (card.type) {
        CardType.Image -> MediaImage(
            primaryUrl = CardSheet.imagePrimaryUrl(card),
            fallbackUrl = card.thumbnailUrl ?: card.screenshotUrl,
            ratio = ratio,
            contentDescription = CardSheet.title(card),
            placeholderIcon = Icons.Outlined.Image,
            placeholderLabel = "Image unavailable",
            modifier = modifier,
            onOpen = openImage,
        )
        CardType.Video -> VideoPreview(card, ratio, modifier)
        CardType.Audio -> AudioPlayer(card.id, card.fileUrl, file?.duration, modifier)
        CardType.Text -> TextSurface(modifier) {
            if (content.isEmpty()) NoContent() else MarkdownText(content)
        }
        CardType.Quote -> QuotePreview(content.ifEmpty { "No content" }, modifier)
        CardType.Palette -> PaletteSwatches(card.colors.orEmpty().take(12), onCopyColor, modifier)
        CardType.Link -> LinkPreview(card, modifier)
        CardType.Document -> DocumentPreview(card, documentText, onViewDocument, modifier)
    }
}

@Composable
private fun TextSurface(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow, MediaShape)
            .padding(20.dp),
    ) {
        content()
    }
}

@Composable
private fun NoContent() {
    Text("No content", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun isGif(card: Card): Boolean =
    card.fileMetadata?.mimeType?.lowercase() == "image/gif" ||
        card.fileMetadata?.fileName?.lowercase()?.endsWith(".gif") == true

@Composable
private fun VideoPreview(card: Card, ratio: Float?, modifier: Modifier) {
    val poster = card.thumbnailUrl ?: card.screenshotUrl
    val url = card.fileUrl
    when {
        isGif(card) -> MediaImage(
            primaryUrl = url,
            fallbackUrl = poster,
            ratio = ratio,
            contentDescription = CardSheet.title(card),
            placeholderIcon = Icons.Outlined.Image,
            placeholderLabel = "Animated preview unavailable",
            modifier = modifier,
        )
        url == null -> MediaImage(
            primaryUrl = poster,
            fallbackUrl = null,
            ratio = ratio,
            contentDescription = CardSheet.title(card),
            placeholderIcon = Icons.Outlined.PlayCircle,
            placeholderLabel = "Video preview unavailable",
            modifier = modifier,
        )
        else -> VideoPlayer(url, poster, ratio, modifier)
    }
}

@Composable
private fun QuotePreview(text: String, modifier: Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow, MediaShape)
            .padding(horizontal = 20.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.FormatQuote,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(28.dp),
        )
        SelectionContainer {
            Text(
                text,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Medium),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** "#abc" or "#aabbcc" (optionally with alpha) as a color, or null. */
internal fun parseHexColor(hex: String): Color? {
    val digits = hex.trim().removePrefix("#")
    val full = when (digits.length) {
        3 -> digits.map { "$it$it" }.joinToString("") + "ff"
        6 -> digits + "ff"
        8 -> digits
        else -> return null
    }
    val value = full.toLongOrNull(16) ?: return null
    // #RRGGBBAA to ARGB.
    return Color(((value and 0xff) shl 24) or (value shr 8))
}

/** Wide swatches with their hex codes, as many per row as fit and balanced across rows. Tap to copy. */
@Composable
private fun PaletteSwatches(colors: List<CardColor>, onCopy: (String) -> Unit, modifier: Modifier) {
    if (colors.isEmpty()) {
        MediaPlaceholder(Icons.Outlined.Palette, "No colors saved", modifier)
        return
    }
    BoxWithConstraints(modifier.fillMaxWidth().clip(MediaShape)) {
        val maxPerRow = (maxWidth / SWATCH_MIN_WIDTH).toInt().coerceIn(1, colors.size)
        val rowCount = ceil(colors.size / maxPerRow.toDouble()).toInt()
        val perRow = ceil(colors.size / rowCount.toDouble()).toInt()
        Column {
            colors.chunked(perRow).forEach { row ->
                Row(Modifier.fillMaxWidth()) {
                    row.forEach { color -> Swatch(color.hex, onCopy, Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun Swatch(hex: String, onCopy: (String) -> Unit, modifier: Modifier) {
    val color = parseHexColor(hex) ?: Color.Gray
    val labelColor = if (color.luminance() > 0.5f) Color.Black else Color.White
    Box(
        modifier
            .height(SWATCH_HEIGHT)
            .background(color)
            .clickable(onClickLabel = "Copy $hex", role = Role.Button) { onCopy(hex) },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Text(
            hex.uppercase(),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            color = labelColor,
            maxLines = 1,
            modifier = Modifier
                .padding(bottom = 10.dp)
                .background(labelColor.copy(alpha = 0.14f), CircleShape)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun LinkPreview(card: Card, modifier: Modifier) {
    val preview = card.metadata?.linkPreview?.takeIf { it.status == "success" }
    val title = listOf(preview?.title, card.metadataTitle, card.url).firstOrNull { !it.isNullOrBlank() } ?: "Link"
    val description = listOf(preview?.description, card.metadataDescription).firstOrNull { !it.isNullOrBlank() }
    val host = CardSheet.hostname(card.url)
    val imageUrl = card.linkPreviewImageUrl ?: card.screenshotUrl
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (imageUrl != null) {
            MediaImage(
                primaryUrl = imageUrl,
                fallbackUrl = null,
                ratio = null,
                contentDescription = null,
                placeholderIcon = Icons.Outlined.Link,
                placeholderLabel = "Preview unavailable",
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (host != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(
                        Icons.Outlined.Language,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                    Text(host, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            if (description != null) {
                Text(
                    description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** "PDF · 4.6 MB", then anything extra like page or word counts. */
internal fun documentFacts(card: Card): List<String> {
    val file = card.fileMetadata ?: return emptyList()
    val extension = (file.extension ?: file.fileName?.substringAfterLast('.', ""))
        ?.removePrefix(".")?.uppercase()?.takeIf { it.isNotEmpty() }
    val size = file.fileSize?.let(CardSheet::formatFileSize)
    return listOfNotNull(extension, size) + CardSheet.fileFacts(card).filter { it != file.kind }
}

@Composable
private fun DocumentPreview(card: Card, text: String?, onViewDocument: (String) -> Unit, modifier: Modifier) {
    val file = card.fileMetadata
    val title = listOf(card.metadataTitle, file?.fileName).firstOrNull { !it.isNullOrBlank() } ?: "Attachment"
    val facts = documentFacts(card)
    val fileUrl = safeExternalUrl(card.fileUrl)
    val openImage = rememberImageViewer(title)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val thumbnail = card.thumbnailUrl ?: card.detailUrl
        if (thumbnail != null) {
            MediaImage(
                primaryUrl = thumbnail,
                fallbackUrl = card.screenshotUrl,
                ratio = mediaRatio(file?.width, file?.height),
                contentDescription = null,
                placeholderIcon = Icons.AutoMirrored.Outlined.InsertDriveFile,
                placeholderLabel = "Preview unavailable",
                onOpen = openImage,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(
                Icons.AutoMirrored.Outlined.InsertDriveFile,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (facts.isNotEmpty()) {
                    Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (text != null) {
            when (textPreviewKind(card)) {
                TextPreviewKind.Markdown -> TextSurface { MarkdownText(text, style = MaterialTheme.typography.bodyMedium) }
                TextPreviewKind.Code -> TextSurface {
                    SelectionContainer {
                        Text(text, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
                    }
                }
                null -> Unit
            }
        }
        if (fileUrl != null) {
            FilledTonalButton(onClick = { onViewDocument(fileUrl) }) {
                Icon(Icons.Outlined.Preview, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("View Document", modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}
