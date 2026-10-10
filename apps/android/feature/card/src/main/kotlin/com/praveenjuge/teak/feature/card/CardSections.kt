package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.DetailRow
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_LINK_MEDIA = 4
private val SectionShape = RoundedCornerShape(20.dp)

/** A titled group of rows on a tinted surface, like the iPhone's inset-grouped list. */
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

/** The link's category facts (price, rating, author…) and the post's extra photos. */
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
        DetailSection("Tags") { ChipRow(tags = tags, onPressTag = onSearchTag) }
    }
}

/** Teak's summary with its tags and colors, then the transcript. */
@Composable
internal fun SummarySections(card: Card, onSearchTag: (String) -> Unit) {
    val summary = card.aiSummary?.trim().orEmpty()
    val tags = card.aiTags.orEmpty().map(String::trim).filter(String::isNotEmpty)
    // Palettes already show their colors as the preview.
    val colors = if (card.type == CardType.Palette) emptyList() else card.colors.orEmpty().take(8).map { it.hex }
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
internal fun InfoSection(card: Card) {
    DetailSection("Info") {
        DetailRows(
            CardSheet.detailRows(card) + listOf(
                DetailRow("Created", formatTimestamp(card.createdAt)),
                DetailRow("Updated", formatTimestamp(card.updatedAt)),
            ),
        )
    }
}

/** Medium date and short time in the device's locale, like iOS. */
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

/** Tag chips that search for their tag, plus small color dots. */
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
                    .background(parseHexColor(hex) ?: MaterialTheme.colorScheme.outline, CircleShape),
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
