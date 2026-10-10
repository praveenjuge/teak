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
import androidx.compose.foundation.text.selection.SelectionContainer
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

/** Extra size for h1, h2 and h3, matching the iPhone note view. */
private val headingSteps = listOf(7, 4, 2)

/**
 * Shows Markdown like the web's note view: headings, lists, quotes, code and rules as blocks,
 * with bold, italics, inline code and links inside each block. The text is selectable.
 */
@Composable
internal fun MarkdownText(text: String, modifier: Modifier = Modifier, style: TextStyle = MaterialTheme.typography.bodyLarge) {
    val blocks = remember(text) { MarkdownBlocks.parse(text) }
    val inline = inlineStyles()
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            blocks.forEach { block -> MarkdownBlockView(block, style, inline) }
        }
    }
}

@Composable
private fun MarkdownBlockView(block: MarkdownBlock, style: TextStyle, inline: InlineStyles) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    when (block) {
        is MarkdownBlock.Heading -> Text(
            text = remember(block.text, inline) { inlineMarkdown(block.text, inline) },
            style = style.copy(
                fontSize = (style.fontSize.value + (headingSteps.getOrNull(block.level - 1) ?: 0)).sp,
                fontWeight = FontWeight.Bold,
                lineHeight = 1.3.em,
            ),
            modifier = Modifier.semantics { heading() },
        )
        is MarkdownBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            block.items.forEach { item ->
                Row(
                    modifier = Modifier.padding(start = (item.depth * 18).dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(item.marker, style = style, color = secondary)
                    Text(remember(item.text, inline) { inlineMarkdown(item.text, inline) }, style = style)
                }
            }
        }
        is MarkdownBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)),
            )
            Text(
                text = remember(block.text, inline) { inlineMarkdown(block.text, inline) },
                style = style,
                color = secondary,
                modifier = Modifier.padding(start = 11.dp),
            )
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
        is MarkdownBlock.Paragraph -> Text(remember(block.text, inline) { inlineMarkdown(block.text, inline) }, style = style)
    }
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

/** Bold, italics, inline code and links in one line of Markdown. Unsafe links stay plain text. */
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

/** The index of the closing backtick. */
private fun codeSpan(text: String, start: Int): Int? =
    text.indexOf('`', start + 1).takeIf { it > start + 1 }

/** The index where the closing `**` or `__` starts. */
private fun strongSpan(text: String, start: Int): Int? {
    val marker = text.substring(start, start + 2)
    if (text.getOrNull(start + 2)?.isWhitespace() != false) return null
    return text.indexOf(marker, start + 2).takeIf { it > start + 2 }
}

/** The index of the closing `*` or `_`, skipping doubled markers and snake_case words. */
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

/** The index of the `)` that closes `[label](url)`. */
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
