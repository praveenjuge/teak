package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.praveenjuge.teak.core.model.PaletteEdit
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
import androidx.compose.ui.platform.LocalConfiguration
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardColor
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.MarkdownListItem
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.model.parseHexArgb
import java.util.Locale
import kotlin.math.ceil

private val SWATCH_MIN_WIDTH = 84.dp
private val SWATCH_HEIGHT = 128.dp

@Composable
internal fun CardPreview(
    card: Card,
    documentText: String?,
    onCopyColor: (String) -> Unit,
    onViewDocument: (String) -> Unit,
    modifier: Modifier = Modifier,
    onToggleTask: ((MarkdownListItem) -> Unit)? = null,
    palette: PaletteEdits? = null,
) {
    val title = CardSheet.title(card).resolve()
    val openImage = rememberImageViewer(title)
    val file = card.fileMetadata
    val ratio = mediaRatio(file?.width, file?.height)
    val content = card.content.trim()
    when (card.type) {
        CardType.Image -> MediaImage(
            primaryUrl = CardSheet.imagePrimaryUrl(card),
            fallbackUrl = card.thumbnailUrl ?: card.screenshotUrl,
            ratio = ratio,
            contentDescription = title,
            placeholderIcon = Icons.Outlined.Image,
            placeholderLabel = tr("native.card.preview.imageUnavailable"),
            modifier = modifier,
            onOpen = openImage,
        )
        CardType.Video -> VideoPreview(card, ratio, modifier)
        CardType.Audio -> AudioPlayer(card.id, card.fileUrl, file?.duration, modifier)
        CardType.Text -> TextSurface(modifier) {
            // The untrimmed note, so a task's line number points at its line in the stored Markdown.
            if (content.isEmpty()) NoContent() else MarkdownText(card.content, onToggleTask = onToggleTask)
        }
        CardType.Quote -> QuotePreview(content.ifEmpty { tr("native.card.noContent") }, modifier)
        CardType.Palette -> PaletteSwatches(card, onCopyColor, palette, modifier)
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
    Text(tr("native.card.noContent"), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun isGif(card: Card): Boolean =
    card.fileMetadata?.mimeType?.lowercase() == "image/gif" ||
        card.fileMetadata?.fileName?.lowercase()?.endsWith(".gif") == true

@Composable
private fun VideoPreview(card: Card, ratio: Float?, modifier: Modifier) {
    val poster = card.thumbnailUrl ?: card.screenshotUrl
    val url = card.fileUrl
    val title = CardSheet.title(card).resolve()
    when {
        isGif(card) -> MediaImage(
            primaryUrl = url,
            fallbackUrl = poster,
            ratio = ratio,
            contentDescription = title,
            placeholderIcon = Icons.Outlined.Image,
            placeholderLabel = tr("native.card.preview.animatedUnavailable"),
            modifier = modifier,
        )
        url == null -> MediaImage(
            primaryUrl = poster,
            fallbackUrl = null,
            ratio = ratio,
            contentDescription = title,
            placeholderIcon = Icons.Outlined.PlayCircle,
            placeholderLabel = tr("native.card.preview.videoUnavailable"),
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

/** Adding and removing a palette's colors from the open card; null in Trash. */
internal class PaletteEdits(val onAdd: (String) -> Unit, val onRemove: (String) -> Unit)

@Composable
private fun PaletteSwatches(card: Card, onCopy: (String) -> Unit, edits: PaletteEdits?, modifier: Modifier) {
    val colors = card.colors.orEmpty().take(PaletteEdit.MAX_COLORS)
    val canAdd = edits != null && PaletteEdit.canAdd(card)
    val canRemove = edits != null && PaletteEdit.canRemove(card)
    var adding by rememberSaveable { mutableStateOf(false) }
    if (colors.isEmpty() && !canAdd) {
        MediaPlaceholder(Icons.Outlined.Palette, tr("native.card.preview.noColors"), modifier)
        return
    }
    // The add tile takes the slot after the last swatch, so rows stay even.
    val tiles: List<CardColor?> = if (canAdd) colors + null else colors
    BoxWithConstraints(modifier.fillMaxWidth().clip(MediaShape)) {
        val maxPerRow = (maxWidth / SWATCH_MIN_WIDTH).toInt().coerceIn(1, tiles.size)
        val rowCount = ceil(tiles.size / maxPerRow.toDouble()).toInt()
        val perRow = ceil(tiles.size / rowCount.toDouble()).toInt()
        Column {
            tiles.chunked(perRow).forEach { row ->
                Row(Modifier.fillMaxWidth()) {
                    row.forEach { color ->
                        if (color == null) {
                            AddColorTile(onClick = { adding = true }, modifier = Modifier.weight(1f))
                        } else {
                            val remove: (() -> Unit)? = PaletteEdit.storedHex(color)?.takeIf { canRemove }
                                ?.let { hex -> { edits?.onRemove?.invoke(hex) } }
                            Swatch(color.hex, onCopy, remove, Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
    if (adding && edits != null) {
        AddColorSheet(card = card, onAdd = edits.onAdd, onDismiss = { adding = false })
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Swatch(hex: String, onCopy: (String) -> Unit, onRemove: (() -> Unit)?, modifier: Modifier) {
    val color = parseHexArgb(hex)?.let(::Color) ?: Color.Gray
    val labelColor = if (color.luminance() > 0.5f) Color.Black else Color.White
    var menuOpen by remember { mutableStateOf(false) }
    Box(
        modifier
            .height(SWATCH_HEIGHT)
            .background(color)
            .combinedClickable(
                onClickLabel = tr("native.card.copyColor", hex),
                role = Role.Button,
                onLongClickLabel = onRemove?.let { tr("native.card.palette.remove", hex.uppercase()) },
                onLongClick = onRemove?.let { { menuOpen = true } },
                onClick = { onCopy(hex) },
            ),
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
        if (onRemove != null) {
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text(tr("native.card.palette.removeColor")) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onRemove()
                    },
                )
            }
        }
    }
}

/** The "+" after the last swatch, which opens Add color. */
@Composable
private fun AddColorTile(onClick: () -> Unit, modifier: Modifier) {
    val label = tr("native.card.palette.addColor")
    Column(
        modifier
            .height(SWATCH_HEIGHT)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Outlined.Add, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            maxLines = 2,
            modifier = Modifier.padding(horizontal = 6.dp).clearAndSetSemantics {},
        )
    }
}

@Composable
private fun LinkPreview(card: Card, modifier: Modifier) {
    val preview = card.metadata?.linkPreview?.takeIf { it.status == "success" }
    val title = CardSheet.linkTitle(card).resolve()
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
                placeholderLabel = tr("native.card.preview.previewUnavailable"),
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

internal fun documentFacts(card: Card, locale: Locale = Locale.getDefault()): List<UiText> {
    val file = card.fileMetadata ?: return emptyList()
    val extension = (file.extension ?: file.fileName?.substringAfterLast('.', ""))
        ?.removePrefix(".")?.uppercase()?.takeIf { it.isNotEmpty() }
    val size = file.fileSize?.let { CardSheet.formatFileSize(it, locale) }
    return listOfNotNull(extension, size).map(UiText::verbatim) + CardSheet.fileFacts(card).filter { it != file.kind?.let(UiText::verbatim) }
}

@Composable
private fun DocumentPreview(card: Card, text: String?, onViewDocument: (String) -> Unit, modifier: Modifier) {
    val file = card.fileMetadata
    val title = listOf(card.metadataTitle, file?.fileName).firstOrNull { !it.isNullOrBlank() } ?: tr("native.card.preview.attachment")
    val facts = documentFacts(card, LocalConfiguration.current.locales[0]).map { it.resolve() }
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
                placeholderLabel = tr("native.card.preview.previewUnavailable"),
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
                Text(tr("native.card.preview.viewDocument"), modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}
