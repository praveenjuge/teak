package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.CardLinks
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.praveenjuge.teak.core.model.MarkdownBlock
import com.praveenjuge.teak.core.model.MarkdownBlocks
import com.praveenjuge.teak.core.model.MarkdownListItem
import com.praveenjuge.teak.core.model.MarkdownTable
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.CollectionItemInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.collectionItemInfo
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Constraints

private val headingSteps = listOf(7, 4, 2)

/** A note's Markdown. [onToggleTask] ticks or unticks a task; without it, checkboxes are read-only. */
@Composable
internal fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    onToggleTask: ((MarkdownListItem) -> Unit)? = null,
) {
    val blocks = remember(text) { MarkdownBlocks.parse(text) }
    val inline = inlineStyles()
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            blocks.forEach { block -> MarkdownBlockView(block, style, inline, onToggleTask) }
        }
    }
}

@Composable
private fun MarkdownBlockView(block: MarkdownBlock, style: TextStyle, inline: InlineStyles, onToggleTask: ((MarkdownListItem) -> Unit)?) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    when (block) {
        is MarkdownBlock.Heading -> InlineText(
            text = block.text,
            style = style.copy(
                fontSize = (style.fontSize.value + (headingSteps.getOrNull(block.level - 1) ?: 0)).sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 1.3.em,
            ),
            inline = inline,
            modifier = Modifier.semantics { heading() },
        )
        is MarkdownBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            block.items.forEach { item ->
                val checked = item.checked
                if (checked != null) {
                    TaskRow(item, checked, style, inline, onToggleTask)
                } else {
                    Row(
                        modifier = Modifier.padding(start = (item.depth * 18).dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(item.marker, style = style, color = secondary)
                        InlineText(item.text, style, inline)
                    }
                }
            }
        }
        is MarkdownBlock.Table -> TableView(block.table, style, inline)
        is MarkdownBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)),
            )
            InlineText(block.text, style.copy(color = secondary), inline, Modifier.padding(start = 11.dp))
        }
        is MarkdownBlock.Code -> Text(
            text = block.text,
            style = style.copy(fontFamily = FontFamily.Monospace, fontSize = style.fontSize * 0.85f),
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp))
                .padding(10.dp),
        )
        MarkdownBlock.Rule -> HorizontalDivider(Modifier.padding(vertical = 4.dp))
        is MarkdownBlock.Paragraph -> InlineText(block.text, style, inline)
    }
}

/** A task with its checkbox; done ones read muted and struck through, as on the web. The whole row ticks it. */
@Composable
private fun TaskRow(
    item: MarkdownListItem,
    checked: Boolean,
    style: TextStyle,
    inline: InlineStyles,
    onToggle: ((MarkdownListItem) -> Unit)?,
) {
    val state = if (checked) tr("native.notes.checked") else tr("native.notes.unchecked")
    val base = Modifier.padding(start = (item.depth * 18).dp)
    val rowModifier = if (onToggle == null) {
        base.semantics(mergeDescendants = true) { stateDescription = state }
    } else {
        base.minimumInteractiveComponentSize().toggleable(value = checked, role = Role.Checkbox) { onToggle(item) }
    }
    Row(rowModifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = null)
        val textStyle = if (checked) {
            style.copy(color = MaterialTheme.colorScheme.onSurfaceVariant, textDecoration = TextDecoration.LineThrough)
        } else {
            style
        }
        InlineText(item.text, textStyle, inline)
    }
}

/** A read-only GFM table with a header row. A wide one scrolls sideways; long cells wrap. */
@Composable
private fun TableView(table: MarkdownTable, style: TextStyle, inline: InlineStyles) {
    val colors = MaterialTheme.colorScheme
    val description = tr("native.notes.table", count = table.rows.size)
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .semantics {
                contentDescription = description
                collectionInfo = CollectionInfo(rowCount = table.rows.size + 1, columnCount = table.header.size)
            },
    ) {
        TableGrid(table.header.size, Modifier.clip(shape).border(1.dp, colors.outlineVariant, shape)) {
            (listOf(table.header) + table.rows).forEachIndexed { rowIndex, row ->
                row.forEachIndexed { columnIndex, text ->
                    Box(
                        Modifier
                            .background(if (rowIndex == 0) colors.surfaceVariant else Color.Transparent)
                            .border(0.5.dp, colors.outlineVariant)
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                            .semantics { collectionItemInfo = CollectionItemInfo(rowIndex, 1, columnIndex, 1) },
                    ) {
                        InlineText(text, if (rowIndex == 0) style.copy(fontWeight = FontWeight.SemiBold) else style, inline)
                    }
                }
            }
        }
    }
}

private val MaxCellWidth = 280.dp

/** Cells in columns as wide as their widest cell (up to [MaxCellWidth], wrapping past it) and rows as tall as their tallest. */
@Composable
private fun TableGrid(columns: Int, modifier: Modifier, content: @Composable () -> Unit) {
    val maxCell = with(LocalDensity.current) { MaxCellWidth.roundToPx() }
    Layout(content, modifier) { measurables, _ ->
        val rows = measurables.chunked(columns)
        val widths = List(columns) { column ->
            rows.maxOf { row -> row.getOrNull(column)?.maxIntrinsicWidth(Constraints.Infinity)?.coerceAtMost(maxCell) ?: 0 }
        }
        val heights = rows.map { row -> row.withIndex().maxOf { (column, cell) -> cell.minIntrinsicHeight(widths[column]) } }
        val placeables = rows.mapIndexed { r, row -> row.mapIndexed { c, cell -> cell.measure(Constraints.fixed(widths[c], heights[r])) } }
        layout(widths.sum(), heights.sum()) {
            var y = 0
            placeables.forEachIndexed { r, row ->
                var x = 0
                row.forEachIndexed { c, placeable ->
                    placeable.place(x, y)
                    x += widths[c]
                }
                y += heights[r]
            }
        }
    }
}

/** The live titles of `[[` links on this screen, and how to open one. Without it, links read as their stored titles. */
internal class CardLinkContext(val targets: Map<String, CardLinkTarget>, val onOpen: (String) -> Unit)

internal val LocalCardLinks = staticCompositionLocalOf<CardLinkContext?> { null }

private val WORD = Regex("\\S+\\s*")

/** A line of inline Markdown; `[[` links in it become pills that wrap with the words around them. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InlineText(text: String, style: TextStyle, inline: InlineStyles, modifier: Modifier = Modifier) {
    val links = LocalCardLinks.current
    val matches = remember(text) { CardLinks.find(text) }
    if (matches.isEmpty()) {
        Text(remember(text, inline) { inlineMarkdown(text, inline) }, style = style, modifier = modifier)
        return
    }
    if (links == null) {
        Text(remember(text, inline) { inlineMarkdown(CardLinks.tokensToText(text), inline) }, style = style, modifier = modifier)
        return
    }
    FlowRow(modifier, itemVerticalAlignment = Alignment.CenterVertically) {
        var cursor = 0
        for (match in matches) {
            InlineWords(text.substring(cursor, match.start), style, inline)
            CardLinkPill(match, links.targets[match.id], links.onOpen)
            cursor = match.end
        }
        InlineWords(text.substring(cursor), style, inline)
    }
}

/**
 * The text between `[[` links, styled as one run so bold or a link spanning words keeps its style, then split into
 * words that wrap around the pills.
 */
@Composable
private fun InlineWords(run: String, style: TextStyle, inline: InlineStyles) {
    val styled = remember(run, inline) { inlineMarkdown(run, inline) }
    WORD.findAll(styled.text).forEach { Text(styled.subSequence(it.range.first, it.range.last + 1), style = style) }
}

@Composable
private fun CardLinkPill(match: CardLinks.Match, target: CardLinkTarget?, onOpen: (String) -> Unit) {
    val missing = target?.missing == true
    val title = if (missing) tr("native.card.preview.missingCard") else target?.title ?: match.title.ifBlank { tr("cards.types.card") }
    val description = if (missing) tr("native.card.preview.missingCardLabel") else tr("native.card.preview.linkedCard", title)
    AssistChip(
        onClick = { onOpen(match.id) },
        enabled = !missing,
        label = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = {
            Icon(
                if (missing) Icons.Outlined.LinkOff else Icons.Outlined.Link,
                contentDescription = null,
                modifier = Modifier.size(AssistChipDefaults.IconSize),
            )
        },
        modifier = Modifier.padding(horizontal = 2.dp).semantics {
            contentDescription = description
        },
    )
}

internal data class InlineStyles(val code: SpanStyle, val link: TextLinkStyles)

@Composable
private fun inlineStyles(): InlineStyles {
    val colors = MaterialTheme.colorScheme
    return InlineStyles(
        code = SpanStyle(fontFamily = FontFamily.Monospace, background = colors.surfaceVariant),
        link = TextLinkStyles(SpanStyle(color = colors.primary, textDecoration = TextDecoration.Underline)),
    )
}

private const val ESCAPABLE = "\\`*_[]()#+-.!>"

internal fun inlineMarkdown(text: String, styles: InlineStyles): AnnotatedString =
    buildAnnotatedString { appendInline(text, styles) }

private fun AnnotatedString.Builder.appendInline(text: String, styles: InlineStyles) {
    val plain = StringBuilder()
    fun flush() {
        if (plain.isNotEmpty()) {
            append(plain.toString())
            plain.clear()
        }
    }
    var index = 0
    while (index < text.length) {
        val char = text[index]
        val next = text.getOrNull(index + 1)
        if (char == '\\' && next != null && next in ESCAPABLE) {
            plain.append(next)
            index += 2
            continue
        }
        val end = when (char) {
            '`' -> codeSpan(text, index)
            '*', '_' -> if (next == char) strongSpan(text, index) else emphasisSpan(text, index)
            '[' -> linkSpan(text, index)
            else -> null
        }
        if (end == null) {
            plain.append(char)
            index += 1
            continue
        }
        flush()
        when (char) {
            '`' -> withStyle(styles.code) { append(text.substring(index + 1, end)) }
            '[' -> appendLink(text.substring(index, end + 1), styles)
            else -> if (next == char) {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { appendInline(text.substring(index + 2, end), styles) }
            } else {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline(text.substring(index + 1, end), styles) }
            }
        }
        index = end + if (next == char && char != '`' && char != '[') 2 else 1
    }
    flush()
}

private fun codeSpan(text: String, start: Int): Int? =
    text.indexOf('`', start + 1).takeIf { it > start + 1 }

private fun strongSpan(text: String, start: Int): Int? {
    val marker = text.substring(start, start + 2)
    if (text.getOrNull(start + 2)?.isWhitespace() != false) return null
    return text.indexOf(marker, start + 2).takeIf { it > start + 2 }
}

private fun emphasisSpan(text: String, start: Int): Int? {
    val marker = text[start]
    if (text.getOrNull(start + 1)?.isWhitespace() != false) return null
    if (marker == '_' && start > 0 && text[start - 1].isLetterOrDigit()) return null
    var index = start + 1
    while (index < text.length) {
        index = text.indexOf(marker, index).takeIf { it >= 0 } ?: return null
        val doubled = text.getOrNull(index + 1) == marker
        val wordContinues = marker == '_' && text.getOrNull(index + 1)?.isLetterOrDigit() == true
        if (!doubled && !wordContinues && !text[index - 1].isWhitespace()) return index
        index += if (doubled) 2 else 1
    }
    return null
}

private fun linkSpan(text: String, start: Int): Int? {
    val close = text.indexOf(']', start + 1).takeIf { it > start + 1 } ?: return null
    if (text.getOrNull(close + 1) != '(') return null
    return text.indexOf(')', close + 2).takeIf { it > close + 2 }
}

private fun AnnotatedString.Builder.appendLink(source: String, styles: InlineStyles) {
    val close = source.indexOf("](")
    val label = source.substring(1, close)
    val url = safeExternalUrl(source.substring(close + 2, source.length - 1))
    if (url == null) {
        appendInline(label, styles)
    } else {
        withLink(LinkAnnotation.Url(url, styles.link)) { appendInline(label, styles) }
    }
}
