package com.praveenjuge.teak.feature.library

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.praveenjuge.teak.core.model.CardGrid
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.MarkdownBlocks

private val TileShape = RoundedCornerShape(16.dp)
private val TilePadding = 14.dp

/** The first non-blank value, else [fallback]. */
private fun firstText(vararg values: String?, fallback: String): String =
    values.firstOrNull { !it.isNullOrBlank() }?.trim() ?: fallback

/** The name a tile shows or is read out by, with the iPhone's fallbacks. */
internal fun tileTitle(card: CardSummary): String = when (card.type) {
    CardType.Link -> firstText(card.title, card.url, fallback = "Link")
    CardType.Document -> firstText(card.title, card.fileName, fallback = "Attachment")
    CardType.Image -> firstText(card.title, card.fileName, fallback = "Image")
    CardType.Video -> firstText(card.title, card.fileName, fallback = "Video")
    CardType.Audio -> firstText(card.title, card.fileName, fallback = "Audio")
    CardType.Palette -> firstText(card.title, fallback = "Palette")
    CardType.Quote -> firstText(card.previewText, fallback = "Quote")
    CardType.Text -> firstText(card.previewText, card.title, fallback = "Note")
}

/** Parses "#RGB", "#RRGGBB" or "#RRGGBBAA" (CSS order). */
internal fun parseHexColor(value: String): Color? {
    val hex = value.trim().removePrefix("#")
    val full = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("")
        6, 8 -> hex
        else -> return null
    }
    val bits = full.toLongOrNull(16) ?: return null
    val argb = if (full.length == 6) 0xFF000000 or bits else ((bits and 0xFF) shl 24) or (bits shr 8)
    return Color(argb)
}

/**
 * One card in the grid. [selected] is null when not selecting. [highlighted] marks the card open
 * beside the grid on wide windows.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun CardTile(
    card: CardSummary,
    selected: Boolean?,
    highlighted: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = tileTitle(card)
    val favorite = card.isFavorited == true
    val description = buildString {
        append(if (card.type == CardType.Text) "Note" else card.type.label).append(", ").append(title)
        if (favorite) append(", Favorite")
    }
    val outlined = highlighted || selected == true
    Box(
        modifier
            .clip(TileShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .combinedClickable(
                onClickLabel = if (selected == null) "Open" else null,
                onLongClickLabel = if (selected == null) "Select" else null,
                onLongClick = onLongClick,
                onClick = onClick,
            )
            .semantics {
                contentDescription = description
                if (selected != null) this.selected = selected
            }
            .then(if (outlined) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, TileShape) else Modifier),
    ) {
        Column(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
            TileContent(card, title)
        }
        when {
            selected != null -> SelectionMark(selected, Modifier.align(Alignment.BottomEnd).padding(8.dp))
            favorite -> Icon(
                Icons.Filled.Favorite,
                contentDescription = null,
                tint = Color(0xFFEF4444),
                modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).size(16.dp),
            )
        }
    }
}

@Composable
private fun TileContent(card: CardSummary, title: String) {
    val imageUrl = CardGrid.tileImageUrl(card)
    when (card.type) {
        CardType.Link -> if (imageUrl != null) {
            TileImage(card, imageUrl)
            HorizontalDivider()
            TileFooter(title, subtitle = CardSheet.hostname(card.url)?.takeIf { it != title })
        } else {
            TileFooter(title, subtitle = CardSheet.hostname(card.url)?.takeIf { it != title }, titleLines = 2)
        }
        CardType.Document -> {
            if (imageUrl != null) {
                TileImage(card, imageUrl, ContentScale.Fit)
                HorizontalDivider()
            }
            TileFooter(title, icon = Icons.Outlined.Description)
        }
        CardType.Image -> TileImage(card, imageUrl)
        CardType.Video -> Box(contentAlignment = Alignment.Center) {
            if (imageUrl != null) {
                TileImage(card, imageUrl)
            } else {
                Box(Modifier.fillMaxWidth().aspectRatio(CardGrid.tileImageRatio(card).toFloat()).background(Color.Black))
            }
            PlayBadge()
        }
        CardType.Audio -> {
            Waveform(card.id)
            TileFooter(title)
        }
        CardType.Palette -> {
            val colors = card.colors.orEmpty().take(12).mapNotNull(::parseHexColor)
            if (colors.isEmpty()) TileText(title) else PaletteStrip(colors)
        }
        CardType.Quote -> QuoteText(title)
        CardType.Text -> TileText(remember(title) { MarkdownBlocks.toPlainText(title) })
    }
}

@Composable
private fun TileText(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        maxLines = 4,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().padding(TilePadding),
    )
}

@Composable
private fun QuoteText(text: String) {
    Column(Modifier.fillMaxWidth().padding(TilePadding), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(
            Icons.Filled.FormatQuote,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(18.dp),
        )
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            fontStyle = FontStyle.Italic,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TileFooter(title: String, subtitle: String? = null, icon: ImageVector? = null, titleLines: Int = 1) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = TilePadding, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = titleLines, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Remote media at the tile's ratio, over a blurred low-res preview until it loads. */
@Composable
private fun TileImage(card: CardSummary, url: String?, contentScale: ContentScale = ContentScale.Crop) {
    var failed by remember(url) { mutableStateOf(false) }
    var loaded by remember(url) { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(CardGrid.tileImageRatio(card).toFloat())
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
        contentAlignment = Alignment.Center,
    ) {
        if (url == null || failed) {
            Icon(Icons.Outlined.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Box
        }
        val placeholder = card.placeholderUrl
        if (placeholder != null && !loaded) {
            AsyncImage(
                model = placeholder,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().blur(12.dp),
            )
        }
        AsyncImage(
            model = ImageRequest.Builder(LocalPlatformContext.current).data(url).crossfade(true).build(),
            contentDescription = null,
            contentScale = contentScale,
            onSuccess = { loaded = true },
            onError = { failed = true },
            modifier = Modifier.matchParentSize(),
        )
    }
}

@Composable
private fun PlayBadge() {
    Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.45f), contentColor = Color.White) {
        Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.padding(10.dp).size(24.dp))
    }
}

@Composable
private fun PaletteStrip(colors: List<Color>) {
    Row(Modifier.fillMaxWidth().height(56.dp)) {
        colors.forEach { color -> Box(Modifier.weight(1f).fillMaxHeight().background(color)) }
    }
}

/** The web's deterministic waveform, so a recording looks the same on every device. */
@Composable
private fun Waveform(seed: String) {
    val heights = remember(seed) { CardGrid.waveformHeights(seed) }
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = TilePadding)) {
        val bar = 2.dp.toPx()
        val gap = ((size.width - heights.size * bar) / (heights.size - 1)).coerceAtLeast(1f)
        val maxHeight = 40.dp.toPx()
        heights.forEachIndexed { index, fraction ->
            val height = fraction * maxHeight
            drawRoundRect(
                color = color,
                topLeft = Offset(index * (bar + gap), (size.height - height) / 2),
                size = Size(bar, height),
                cornerRadius = CornerRadius(bar / 2),
            )
        }
    }
}

/** The Photos-style check shown on each tile while selecting. */
@Composable
private fun SelectionMark(selected: Boolean, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = CircleShape, color = MaterialTheme.colorScheme.surface, shadowElevation = 2.dp) {
        Icon(
            if (selected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(24.dp),
        )
    }
}
