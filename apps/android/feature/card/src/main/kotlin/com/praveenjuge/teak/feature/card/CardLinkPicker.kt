package com.praveenjuge.teak.feature.card

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.LinkedCard

/**
 * The note or quote field. In a note, typing `[[` opens a dropdown of cards under it; picking one puts in
 * `[[Title|teak:<id>]]`. Escape, Back or a tap outside closes it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ContentField(
    content: String,
    cursor: Int?,
    isQuote: Boolean,
    picker: LinkPickerState?,
    onChange: (String, Int) -> Unit,
    onPick: (LinkedCard) -> Unit,
    onDismissPicker: () -> Unit,
) {
    var field by remember { mutableStateOf(TextFieldValue(content, TextRange(content.length))) }
    // A link put in by the ViewModel replaces the text; the cursor goes where it says.
    LaunchedEffect(content, cursor) {
        if (field.text != content) {
            val at = (cursor ?: content.length).coerceIn(0, content.length)
            field = TextFieldValue(content, TextRange(at))
        }
    }
    BackHandler(enabled = picker != null, onBack = onDismissPicker)

    ExposedDropdownMenuBox(expanded = picker != null, onExpandedChange = {}) {
        OutlinedTextField(
            value = field,
            onValueChange = {
                field = it
                onChange(it.text, it.selection.end)
            },
            label = { Text(if (isQuote) tr("cards.types.quote") else tr("native.card.note")) },
            placeholder = { Text(if (isQuote) tr("native.card.edit.quotePlaceholder") else tr("native.card.edit.notePlaceholder")) },
            supportingText = if (isQuote) null else ({ Text(tr("native.linkPicker.hint")) }),
            minLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable)
                .onPreviewKeyEvent { event ->
                    val escape = picker != null && event.key == Key.Escape
                    if (escape && event.type == KeyEventType.KeyUp) onDismissPicker()
                    escape
                },
        )
        if (picker != null) {
            val label = tr("native.linkPicker.label")
            ExposedDropdownMenu(
                expanded = true,
                onDismissRequest = onDismissPicker,
                modifier = Modifier
                    .heightIn(max = 320.dp)
                    .semantics { paneTitle = label },
            ) {
                LinkPickerRows(picker, onPick)
            }
        }
    }
}

@Composable
private fun LinkPickerRows(picker: LinkPickerState, onPick: (LinkedCard) -> Unit) {
    val cards = picker.cards.orEmpty()
    cards.forEach { card ->
        val option = tr("native.linkPicker.option", card.title)
        DropdownMenuItem(
            text = { Text(card.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            leadingIcon = { Icon(cardTypeIcon(card.type), contentDescription = null) },
            onClick = { onPick(card) },
            modifier = Modifier.semantics { contentDescription = option },
        )
    }
    val message = when {
        picker.failed -> tr("native.linkPicker.failed")
        picker.isLoading -> tr("native.linkPicker.searching")
        cards.isEmpty() && picker.query.isBlank() -> tr("native.linkPicker.noCards")
        cards.isEmpty() -> tr("native.linkPicker.noMatches")
        else -> null
    }
    if (message != null) {
        DropdownMenuItem(
            text = { Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) },
            onClick = {},
            enabled = false,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
