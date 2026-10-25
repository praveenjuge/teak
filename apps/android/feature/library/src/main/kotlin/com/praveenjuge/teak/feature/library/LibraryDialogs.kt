package com.praveenjuge.teak.feature.library

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.MAX_BULK_TAGS
import com.praveenjuge.teak.core.model.MAX_TAG_NAME_LENGTH
import com.praveenjuge.teak.core.model.UiText

/** Tags typed as "design, inspiration", or why they can't be added. */
internal data class BulkTags(val tags: List<String>, val error: UiText? = null) {
    val canAdd: Boolean get() = error == null && tags.isNotEmpty()
}

internal fun parseBulkTags(text: String): BulkTags {
    val tags = text.split(',').map(CardEdit::normalizeTag).filter(String::isNotEmpty).distinct()
    return when {
        tags.any { it.length > MAX_TAG_NAME_LENGTH } -> BulkTags(tags, UiText.of("errors.tags.NAME_TOO_LONG", MAX_TAG_NAME_LENGTH))
        tags.size > MAX_BULK_TAGS -> BulkTags(tags, UiText.of("native.bulk.tooManyTags", MAX_BULK_TAGS))
        else -> BulkTags(tags)
    }
}

@Composable
internal fun AddTagsDialog(count: Int, onAdd: (List<String>) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val parsed = parseBulkTags(text)
    val error = parsed.error?.resolve()
    val submit = { if (parsed.canAdd) onAdd(parsed.tags) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("native.bulk.addTagsTitle", count = count)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(tr("native.bulk.tagsHint"))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text(tr("native.bulk.tagsLabel")) },
                    placeholder = { Text(tr("native.bulk.tagsPlaceholder")) },
                    singleLine = true,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Done),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { submit() }, enabled = parsed.canAdd) { Text(tr("native.actions.addTags")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
}

/** Picks a manual folder for the selection, or makes one from the typed name. */
@Composable
internal fun FolderPickerDialog(
    count: Int,
    folders: List<Folder>,
    onPick: (Folder) -> Unit,
    onCreate: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val trimmed = query.trim()
    val visible = folders.filter { trimmed.isEmpty() || it.name.contains(trimmed, ignoreCase = true) }
    val canCreate = trimmed.isNotEmpty() && folders.none { it.name.equals(trimmed, ignoreCase = true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("native.bulk.addToFolderTitle", count = count)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text(tr("native.bulk.findFolder")) },
                    label = { Text(tr("native.bulk.searchFolders")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(visible, key = { it.id }) { folder ->
                        FolderRow(folder.name, "${folder.cardCount}", Icons.Outlined.Folder) { onPick(folder) }
                    }
                    if (canCreate) {
                        item { FolderRow(tr("native.bulk.createFolder", trimmed), null, Icons.Outlined.CreateNewFolder) { onCreate(trimmed) } }
                    }
                    if (visible.isEmpty() && !canCreate) {
                        item {
                            Text(
                                if (folders.isEmpty()) tr("native.bulk.noFolders") else tr("native.bulk.noFolderMatch"),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
}

@Composable
private fun FolderRow(title: String, trailing: String?, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        leadingContent = { Icon(icon, contentDescription = null) },
        trailingContent = trailing?.let { { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
internal fun SaveSearchDialog(search: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("native.library.saveSearch.title")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(tr("native.library.saveSearch.message"))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(tr("native.library.saveSearch.nameLabel")) },
                    placeholder = { Text(tr("native.library.saveSearch.namePlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                Text(search, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(name) }, enabled = name.isNotBlank()) { Text(tr("native.library.saveSearch.save")) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
}
