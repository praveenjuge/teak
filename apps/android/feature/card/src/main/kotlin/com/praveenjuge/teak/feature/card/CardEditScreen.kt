package com.praveenjuge.teak.feature.card

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.CardEditDraft
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.UiText

internal class CardEditCallbacks(
    val onClose: () -> Unit,
    val onSave: () -> Unit,
    val onContentChange: (String) -> Unit,
    val onNotesChange: (String) -> Unit,
    val onNewTagChange: (String) -> Unit,
    val onAddTag: () -> Unit,
    val onRemoveTag: (String) -> Unit,
    val onRemoveAiTag: (String) -> Unit,
    val onDismissAlert: () -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CardEditScreen(state: CardEditUiState, callbacks: CardEditCallbacks) {
    var confirmDiscard by rememberSaveable { mutableStateOf(false) }
    val close = { if (state.hasChanges) confirmDiscard = true else callbacks.onClose() }
    BackHandler(enabled = state.hasChanges) { confirmDiscard = true }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tr("native.card.edit.title")) },
                navigationIcon = {
                    IconButton(onClick = close) { Icon(Icons.Filled.Close, contentDescription = tr("common.close")) }
                },
                actions = {
                    Button(onClick = callbacks.onSave, enabled = state.canSave, modifier = Modifier.padding(end = 8.dp)) {
                        Text(if (state.isSaving) tr("common.saving") else tr("common.save"))
                    }
                },
            )
        },
    ) { padding ->
        val card = state.card
        val draft = state.draft
        when {
            state.isLoading -> TeakLoading(Modifier.padding(padding))
            card == null || draft == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                EmptyState(
                    title = tr("native.card.unavailable.title"),
                    message = tr("native.card.unavailable.deletedMessage"),
                    icon = Icons.Outlined.ErrorOutline,
                )
            }
            else -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                EditForm(
                    type = card.type,
                    draft = draft,
                    newTag = state.newTag,
                    hiddenHint = state.hiddenHint,
                    showAiTags = card.aiTags.orEmpty().isNotEmpty(),
                    callbacks = callbacks,
                )
            }
        }
    }

    if (confirmDiscard) {
        ConfirmDialog(
            title = tr("native.card.edit.discardTitle"),
            message = tr("native.card.edit.discardMessage"),
            confirmLabel = tr("native.card.edit.discard"),
            onConfirm = {
                confirmDiscard = false
                callbacks.onClose()
            },
            onDismiss = { confirmDiscard = false },
        )
    }
    state.alert?.let { alert ->
        AlertDialog(
            onDismissRequest = callbacks.onDismissAlert,
            title = { Text(alert.title.resolve()) },
            text = { Text(alert.message.resolve()) },
            confirmButton = { TextButton(onClick = callbacks.onDismissAlert) { Text(tr("native.card.edit.ok")) } },
        )
    }
}

@Composable
private fun EditForm(
    type: CardType,
    draft: CardEditDraft,
    newTag: String,
    hiddenHint: UiText?,
    showAiTags: Boolean,
    callbacks: CardEditCallbacks,
) {
    Column(
        modifier = Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        val content = draft.editableContent
        if (content != null) {
            val isQuote = type == CardType.Quote
            OutlinedTextField(
                value = content,
                onValueChange = callbacks.onContentChange,
                label = { Text(if (isQuote) tr("cards.types.quote") else tr("native.card.note")) },
                placeholder = { Text(if (isQuote) tr("native.card.edit.quotePlaceholder") else tr("native.card.edit.notePlaceholder")) },
                minLines = 4,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = draft.notes,
            onValueChange = callbacks.onNotesChange,
            label = { Text(tr("native.card.sections.notes")) },
            placeholder = { Text(tr("native.card.edit.notesPlaceholder")) },
            minLines = 2,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth(),
        )
        FormSection(tr("native.card.sections.tags")) {
            if (draft.tags.isNotEmpty()) {
                RemovableChips(draft.tags, sparkles = false, onRemove = callbacks.onRemoveTag)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = newTag,
                    onValueChange = callbacks.onNewTagChange,
                    placeholder = { Text(tr("native.card.edit.tagPlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrectEnabled = false,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { callbacks.onAddTag() }),
                    modifier = Modifier.weight(1f),
                )
                FilledTonalButton(onClick = callbacks.onAddTag, enabled = newTag.isNotBlank()) { Text(tr("common.add")) }
            }
            if (hiddenHint != null) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                ) {
                    Icon(Icons.Outlined.VisibilityOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    Text(hiddenHint.resolve(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (showAiTags) {
            FormSection(tr("native.card.edit.aiTags")) {
                if (draft.aiTags.isNotEmpty()) {
                    RemovableChips(draft.aiTags, sparkles = true, onRemove = callbacks.onRemoveAiTag)
                }
                Text(
                    tr("native.card.edit.aiTagsHint"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FormSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.semantics { heading() },
        )
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RemovableChips(tags: List<String>, sparkles: Boolean, onRemove: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        tags.forEach { tag ->
            InputChip(
                selected = false,
                onClick = { onRemove(tag) },
                label = { Text(tag) },
                leadingIcon = if (sparkles) {
                    { Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(InputChipDefaults.IconSize)) }
                } else {
                    null
                },
                trailingIcon = {
                    Icon(Icons.Filled.Close, contentDescription = tr("native.card.edit.removeTag", tag), modifier = Modifier.size(InputChipDefaults.AvatarSize))
                },
            )
        }
    }
}
