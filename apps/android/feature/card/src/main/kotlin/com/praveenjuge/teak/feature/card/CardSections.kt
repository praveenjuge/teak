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
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalConfiguration
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardDetails
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.CardSource
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.DetailRow
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.model.parseHexArgb
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_LINK_MEDIA = 4
private val SectionShape = RoundedCornerShape(20.dp)
/** Rows that open something are at least this tall, so they're easy to tap. */
private val MinTouchHeight = 48.dp

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
        DetailSection(tr("native.card.sections.details")) { DetailRows(facts.map { DetailRow(UiText.verbatim(it.label), it.value) }) }
    }
    val media = card.linkPreviewMedia.orEmpty()
        .mapNotNull { item -> (if (item.type == "image") item.url else item.posterUrl)?.let { it to item } }
        .take(MAX_LINK_MEDIA)
    if (media.size > 1) {
        DetailSection(tr("native.card.sections.media")) {
            media.forEach { (url, item) ->
                MediaImage(
                    primaryUrl = url,
                    fallbackUrl = null,
                    ratio = mediaRatio(item.width, item.height),
                    contentDescription = null,
                    placeholderIcon = Icons.Outlined.Image,
                    placeholderLabel = tr("native.card.preview.mediaUnavailable"),
                    onOpen = onOpenImage,
                )
            }
        }
    }
}

/** Keep and Remove for Teak's suggested tags. */
internal class SuggestedTagActions(val keep: (String) -> Unit, val remove: (String) -> Unit)

/** [suggested] is null in Trash, where Teak's tags show without Keep and Remove. */
@Composable
internal fun NotesAndTagsSections(card: Card, onSearchTag: (String) -> Unit, suggested: SuggestedTagActions? = null) {
    val notes = card.notes?.trim().orEmpty()
    val tags = card.tags.orEmpty().map(String::trim).filter(String::isNotEmpty)
    val suggestedTags = CardEdit.suggestedTags(card)
    if (notes.isNotEmpty()) {
        DetailSection(tr("native.card.sections.notes")) { MarkdownText(notes) }
    }
    if (tags.isNotEmpty() || suggestedTags.isNotEmpty()) {
        DetailSection(tr("native.card.sections.tags")) {
            if (card.hidden) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.VisibilityOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    Text(
                        tr("native.card.hiddenCardHint"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (tags.isNotEmpty()) ChipRow(tags = tags, onPressTag = onSearchTag)
            if (suggestedTags.isNotEmpty()) SuggestedTagRow(suggestedTags, suggested, onSearchTag)
        }
    }
}

/** "Suggested by Teak": tags Teak added, each with Keep and Remove, like the web's card details. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SuggestedTagRow(tags: List<String>, actions: SuggestedTagActions?, onPressTag: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            Text(tr("native.tags.suggested"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            tags.forEach { tag ->
                val keepLabel = tr("native.tags.keepTag", tag)
                if (actions == null) {
                    SuggestionChip(onClick = { onPressTag(tag) }, label = { Text(tag) })
                } else {
                    // Remove sits beside the chip, not inside it, so it gets a full-size target apart from Keep.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        InputChip(
                            selected = false,
                            onClick = { actions.keep(tag) },
                            label = { Text(tag) },
                            leadingIcon = { Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(InputChipDefaults.IconSize)) },
                            modifier = Modifier.semantics {
                                onClick(label = keepLabel) {
                                    actions.keep(tag)
                                    true
                                }
                            },
                        )
                        IconButton(onClick = { actions.remove(tag) }) {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = tr("native.card.edit.removeTag", tag),
                                modifier = Modifier.size(InputChipDefaults.IconSize),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SummarySections(card: Card) {
    val summary = card.aiSummary?.trim().orEmpty()
    val colors = if (card.type.showsSummaryColors) card.colors.orEmpty().take(8).map { it.hex } else emptyList()
    val transcript = card.aiTranscript?.trim().orEmpty()
    if (summary.isNotEmpty() || colors.isNotEmpty()) {
        DetailSection(tr("native.card.sections.summary")) {
            if (summary.isNotEmpty()) SelectableText(summary)
            if (colors.isNotEmpty()) ChipRow(tags = emptyList(), colors = colors, onPressTag = {})
        }
    }
    if (transcript.isNotEmpty()) {
        DetailSection(tr("native.card.sections.transcript")) { SelectableText(transcript) }
    }
}

@Composable
internal fun InfoSection(card: Card, folders: List<Folder>, onOpenSource: (String) -> Unit, onEditFolders: () -> Unit) {
    val locale = LocalConfiguration.current.locales[0]
    DetailSection(tr("native.card.sections.info")) {
        CardDetails.source(card)?.let { source ->
            SourceRow(source, onOpenSource)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        }
        if (!card.deleted) {
            FoldersRow(folders, onEditFolders)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        }
        DetailRows(
            CardSheet.detailRows(card, locale) + CardDetails.extraRows(card, locale = locale) + listOf(
                DetailRow(UiText.of("native.details.created"), formatTimestamp(card.createdAt, locale)),
                DetailRow(UiText.of("native.details.updated"), formatTimestamp(card.updatedAt, locale)),
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
            .heightIn(min = MinTouchHeight)
            .clickable(onClickLabel = tr("native.card.source.open", source.title ?: source.host)) { onOpen(source.url) },
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(tr("native.card.source.label"), style = MaterialTheme.typography.bodyLarge)
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
        folders.isEmpty() -> tr("native.card.folderRow.add")
        folders.size == 1 -> folders.single().name
        else -> tr("native.card.folderRow.summary", folders.first().name, NumberFormat.getIntegerInstance(LocalConfiguration.current.locales[0]).format(folders.size - 1))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchHeight)
            .clickable(onClickLabel = if (folders.isEmpty()) tr("native.card.folderRow.addLabel") else tr("native.card.folderRow.change"), onClick = onEdit),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(tr("native.card.sections.folders"), style = MaterialTheme.typography.bodyLarge)
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
    DetailSection(tr("native.card.sections.linkedFrom")) {
        backlinks.backlinks.forEach { linked ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = MinTouchHeight).clickable { onOpenCard(linked.id) },
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(cardTypeIcon(linked.type), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(linked.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (backlinks.hasMore) Text(tr("native.card.backlinksMore"), color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        BoxWithConstraints {
            // A long label wraps at half the row, so large text never squeezes the value to a sliver.
            val labelWidth = maxWidth / 2
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(row.label.resolve(), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.widthIn(max = labelWidth))
                SelectionContainer(Modifier.weight(1f)) {
                    Text(
                        row.value.resolve(),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.End,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
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
            SuggestionChip(onClick = { onPressTag(tag) }, label = { Text(tag) })
        }
    }
}
