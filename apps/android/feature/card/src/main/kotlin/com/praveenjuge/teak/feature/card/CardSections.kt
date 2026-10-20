package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardDetails
import com.praveenjuge.teak.core.model.CardSource
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.DetailRow
import com.praveenjuge.teak.core.model.parseHexArgb
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_LINK_MEDIA = 4
private val SectionShape = RoundedCornerShape(20.dp)

@Composable
internal fun DetailSection(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 4.dp).semantics { heading() },
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceContainerLow, SectionShape)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun SelectableText(text: String) {
    SelectionContainer { Text(text, style = MaterialTheme.typography.bodyLarge) }
}

@Composable
internal fun LinkDetailsSections(card: Card, onOpenImage: (String) -> Unit) {
    if (card.type != CardType.Link) return
    val facts = card.metadata?.linkCategory?.facts.orEmpty()
    if (facts.isNotEmpty()) {
        DetailSection("Details") { DetailRows(facts.map { DetailRow(it.label, it.value) }) }
    }
    val media = card.linkPreviewMedia.orEmpty()
        .mapNotNull { item -> (if (item.type == "image") item.url else item.posterUrl)?.let { it to item } }
        .take(MAX_LINK_MEDIA)
    if (media.size > 1) {
        DetailSection("Media") {
            media.forEach { (url, item) ->
                MediaImage(
                    primaryUrl = url,
                    fallbackUrl = null,
                    ratio = mediaRatio(item.width, item.height),
                    contentDescription = null,
                    placeholderIcon = Icons.Outlined.Image,
                    placeholderLabel = "Media unavailable",
                    onOpen = onOpenImage,
                )
            }
        }
    }
}

@Composable
internal fun NotesAndTagsSections(card: Card, onSearchTag: (String) -> Unit) {
    val notes = card.notes?.trim().orEmpty()
    val tags = card.tags.orEmpty().map(String::trim).filter(String::isNotEmpty)
    if (notes.isNotEmpty()) {
        DetailSection("Notes") { MarkdownText(notes) }
    }
    if (tags.isNotEmpty()) {
        DetailSection("Tags") {
            if (card.hidden) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.VisibilityOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    Text(
                        "Hidden. Only a search for #secret or #hidden shows this card.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            ChipRow(tags = tags, onPressTag = onSearchTag)
        }
    }
}

@Composable
internal fun SummarySections(card: Card, onSearchTag: (String) -> Unit) {
    val summary = card.aiSummary?.trim().orEmpty()
    val tags = card.aiTags.orEmpty().map(String::trim).filter(String::isNotEmpty)
    val colors = if (card.type.showsSummaryColors) card.colors.orEmpty().take(8).map { it.hex } else emptyList()
    val transcript = card.aiTranscript?.trim().orEmpty()
    if (summary.isNotEmpty() || tags.isNotEmpty() || colors.isNotEmpty()) {
        DetailSection("Summary") {
            if (summary.isNotEmpty()) SelectableText(summary)
            if (tags.isNotEmpty() || colors.isNotEmpty()) {
                ChipRow(tags = tags, colors = colors, sparkles = true, onPressTag = onSearchTag)
            }
        }
    }
    if (transcript.isNotEmpty()) {
        DetailSection("Transcript") { SelectableText(transcript) }
    }
}

@Composable
internal fun InfoSection(card: Card, folders: List<Folder>, onOpenSource: (String) -> Unit, onEditFolders: () -> Unit) {
    DetailSection("Info") {
        CardDetails.source(card)?.let { source ->
            SourceRow(source, onOpenSource)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        }
        if (!card.deleted) {
            FoldersRow(folders, onEditFolders)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        }
        DetailRows(
            CardSheet.detailRows(card) + CardDetails.extraRows(card) + listOf(
                DetailRow("Created", formatTimestamp(card.createdAt)),
                DetailRow("Updated", formatTimestamp(card.updatedAt)),
            ),
        )
    }
}

/** "From example.com": where a text card was saved from, opening the page. */
@Composable
private fun SourceRow(source: CardSource, onOpen: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = "Open ${source.title ?: source.host}") { onOpen(source.url) },
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("From", style = MaterialTheme.typography.bodyLarge)
        Text(
            source.host,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.primary,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun FoldersRow(folders: List<Folder>, onEdit: () -> Unit) {
    val value = when {
        folders.isEmpty() -> "Add…"
        folders.size == 1 -> folders.single().name
        else -> "${folders.first().name} +${folders.size - 1}"
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = if (folders.isEmpty()) "Add to a folder" else "Change folders", onClick = onEdit),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Folders", style = MaterialTheme.typography.bodyLarge)
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.primary,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Cards whose notes link here with `[[`, newest first; hidden when there are none. */
@Composable
internal fun LinkedFromSection(backlinks: CardBacklinks, onOpenCard: (String) -> Unit) {
    if (backlinks.backlinks.isEmpty()) return
    DetailSection("Linked from") {
        backlinks.backlinks.forEach { linked ->
            Row(
                Modifier.fillMaxWidth().clickable { onOpenCard(linked.id) },
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(cardTypeIcon(linked.type), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(linked.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (backlinks.hasMore) Text("and more", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

internal fun cardTypeIcon(type: CardType): ImageVector = when (type) {
    CardType.Text -> Icons.AutoMirrored.Outlined.Notes
    CardType.Link -> Icons.Outlined.Link
    CardType.Image -> Icons.Outlined.Image
    CardType.Video -> Icons.Outlined.Movie
    CardType.Audio -> Icons.Outlined.GraphicEq
    CardType.Document -> Icons.Outlined.Description
    CardType.Palette -> Icons.Outlined.Palette
    CardType.Quote -> Icons.Outlined.FormatQuote
}

internal fun formatTimestamp(epochMillis: Double, locale: Locale = Locale.getDefault(), zone: ZoneId = ZoneId.systemDefault()): String =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .withZone(zone)
        .format(Instant.ofEpochMilli(epochMillis.toLong()))

@Composable
private fun DetailRows(rows: List<DetailRow>) {
    rows.forEachIndexed { index, row ->
        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(row.label, style = MaterialTheme.typography.bodyLarge)
            SelectionContainer(Modifier.weight(1f)) {
                Text(
                    row.value,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.End,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ChipRow(
    tags: List<String>,
    onPressTag: (String) -> Unit,
    colors: List<String> = emptyList(),
    sparkles: Boolean = false,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        colors.forEach { hex ->
            Box(
                Modifier
                    .size(22.dp)
                    .background(parseHexArgb(hex)?.let(::Color) ?: MaterialTheme.colorScheme.outline, CircleShape),
            )
        }
        tags.forEach { tag ->
            if (sparkles) {
                AssistChip(
                    onClick = { onPressTag(tag) },
                    label = { Text(tag) },
                    leadingIcon = {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(AssistChipDefaults.IconSize))
                    },
                )
            } else {
                SuggestionChip(onClick = { onPressTag(tag) }, label = { Text(tag) })
            }
        }
    }
}
