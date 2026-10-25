package com.praveenjuge.teak.feature.capture.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Warning
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.feature.capture.formatCount
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

private data class ShareStatus(val title: String, val message: String, val icon: ImageVector?)

@Composable
private fun ShareUiState.status(): ShareStatus = when (this) {
    ShareUiState.Resolving, ShareUiState.Saving -> ShareStatus(tr("common.saving"), tr("native.share.saving"), null)
    is ShareUiState.Saved -> ShareStatus(tr("native.capture.saved"), tr("native.share.savedMessage"), Icons.Filled.CheckCircle)
    ShareUiState.Empty -> ShareStatus(tr("native.share.nothingToSave"), tr("native.share.nothingToSaveMessage"), Icons.Filled.Inbox)
    ShareUiState.SignInRequired -> ShareStatus(
        tr("native.share.signInRequired"),
        tr("native.share.signInMessage"),
        Icons.Filled.AccountCircle,
    )
    is ShareUiState.Partial -> ShareStatus(
        tr("native.capture.savedSome", formatCount(saved), formatCount(total)),
        detail?.resolve() ?: tr("native.share.partialMessage"),
        Icons.Filled.Warning,
    )
    is ShareUiState.Failed -> ShareStatus(
        tr("native.capture.couldntSave"),
        detail?.resolve() ?: tr("native.errors.offline"),
        Icons.Filled.Error,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShareSheet(
    state: ShareUiState,
    closeRequests: Flow<Unit>,
    onOpenTeak: () -> Unit,
    onClosed: () -> Unit,
    details: ShareDetailsActions = ShareDetailsActions(),
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onClosed() }
    }
    LaunchedEffect(closeRequests) { closeRequests.collect { close() } }

    ModalBottomSheet(
        onDismissRequest = onClosed,
        sheetState = sheetState,
    ) {
        ShareSheetContent(state = state, onOpenTeak = onOpenTeak, onClose = close, details = details)
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun ShareSheetContent(
    state: ShareUiState,
    onOpenTeak: () -> Unit,
    onClose: () -> Unit,
    details: ShareDetailsActions = ShareDetailsActions(),
) {
    val status = state.status()
    Column(
        modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            tr("android.share.saveToTeak"),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { heading() },
        )
        Box(Modifier.heightIn(min = 56.dp), contentAlignment = Alignment.Center) {
            if (status.icon == null) {
                LoadingIndicator()
            } else {
                Icon(status.icon, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        ) {
            Text(status.title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                status.message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        when (state) {
            ShareUiState.SignInRequired -> Button(onClick = onOpenTeak) { Text(tr("native.share.openTeak")) }
            ShareUiState.Empty, is ShareUiState.Partial, is ShareUiState.Failed ->
                OutlinedButton(onClick = onClose) { Text(tr("common.close")) }
            is ShareUiState.Saved -> if (state.cardId != null) {
                val form = state.details
                if (form == null) {
                    OutlinedButton(onClick = details.onAdd) { Text(tr("native.share.addDetails")) }
                } else {
                    ShareDetailsForm(form, details, onSkip = onClose)
                }
            }
            else -> Unit
        }
    }
}

internal data class ShareDetailsActions(
    val onAdd: () -> Unit = {},
    val onTagInput: (String) -> Unit = {},
    val onAddTag: () -> Unit = {},
    val onRemoveTag: (String) -> Unit = {},
    val onNote: (String) -> Unit = {},
    val onSave: () -> Unit = {},
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShareDetailsForm(form: ShareDetails, actions: ShareDetailsActions, onSkip: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (form.tags.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                form.tags.forEach { tag ->
                    InputChip(
                        selected = false,
                        onClick = { actions.onRemoveTag(tag) },
                        label = { Text(tag) },
                        trailingIcon = { Icon(Icons.Filled.Close, contentDescription = tr("native.card.edit.removeTag", tag), modifier = Modifier.size(InputChipDefaults.AvatarSize)) },
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = form.tagInput,
                onValueChange = actions.onTagInput,
                placeholder = { Text(tr("native.card.edit.tagPlaceholder")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { actions.onAddTag() }),
                modifier = Modifier.weight(1f),
            )
            FilledTonalButton(onClick = actions.onAddTag, enabled = form.tagInput.isNotBlank()) { Text(tr("common.add")) }
        }
        form.hiddenHint?.let {
            Text(it.resolve(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        OutlinedTextField(
            value = form.note,
            onValueChange = actions.onNote,
            label = { Text(tr("native.share.note")) },
            placeholder = { Text(tr("native.share.addNote")) },
            minLines = 2,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = Modifier.fillMaxWidth(),
        )
        if (form.failed) {
            Text(tr("native.share.detailsFailed"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End)) {
            TextButton(onClick = onSkip, enabled = !form.isSaving) { Text(tr("native.share.skip")) }
            Button(onClick = actions.onSave, enabled = !form.isSaving) {
                Text(if (form.isSaving) tr("common.saving") else tr("common.save"))
            }
        }
    }
}
