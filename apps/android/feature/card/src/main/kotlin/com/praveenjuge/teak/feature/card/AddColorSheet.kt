package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.PaletteEdit
import com.praveenjuge.teak.core.model.parseHexArgb
import kotlinx.coroutines.launch

/** Quick picks, since Material 3 has no color picker. Any hex code can be typed instead. */
private val PRESETS = listOf("#E63946", "#F4A261", "#E9C46A", "#2A9D8F", "#4ECDC4", "#457B9D", "#6D597A", "#264653")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun AddColorSheet(card: Card, onAdd: (String) -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var input by rememberSaveable { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    val hex = PaletteEdit.normalizedHex(input)
    val error = when {
        !PaletteEdit.canAdd(card) -> tr("native.card.palette.full")
        input.isBlank() -> null
        hex == null -> tr("native.card.palette.invalidHex")
        PaletteEdit.contains(card, hex) -> tr("native.card.palette.alreadyAdded", hex)
        else -> null
    }
    val ready = hex != null && error == null
    fun submit() {
        if (!ready || hex == null) return
        onAdd(hex)
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                tr("native.card.palette.addColor"),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() },
            )
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                ColorPreview(hex, Modifier.padding(top = 8.dp))
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    label = { Text(tr("native.card.palette.hexCode")) },
                    placeholder = { Text("#FF5500") },
                    singleLine = true,
                    isError = error != null,
                    // Blank, the hint says what to type; anything else that isn't a new color says why.
                    supportingText = { Text(error ?: tr("native.card.palette.invalidHex").takeIf { input.isBlank() }.orEmpty()) },
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Ascii,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.weight(1f).focusRequester(focus),
                )
            }
            Text(
                tr("native.card.palette.pickColor"),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PRESETS.forEach { preset -> PresetSwatch(preset, selected = preset == hex) { input = preset } }
            }
            Button(onClick = ::submit, enabled = ready, modifier = Modifier.fillMaxWidth()) {
                Text(tr("native.card.palette.add"))
            }
        }
    }
}

@Composable
private fun ColorPreview(hex: String?, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(12.dp)
    val fill = hex?.let(::parseHexArgb)?.let(::Color) ?: MaterialTheme.colorScheme.surfaceContainerHigh
    Box(
        modifier
            .size(48.dp)
            .background(fill, shape)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape),
    )
}

@Composable
private fun PresetSwatch(hex: String, selected: Boolean, onClick: () -> Unit) {
    val ring = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    Box(
        Modifier
            .size(36.dp)
            .border(if (selected) 2.dp else 1.dp, ring, CircleShape)
            .padding(3.dp)
            .clip(CircleShape)
            .background(parseHexArgb(hex)?.let(::Color) ?: Color.Gray)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = hex },
    )
}
