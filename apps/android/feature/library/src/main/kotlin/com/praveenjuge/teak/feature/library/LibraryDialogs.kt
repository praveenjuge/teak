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
import com.praveenjuge.teak.core.model.BulkCopy
import com.praveenjuge.teak.core.model.CardEdit
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.MAX_BULK_TAGS
import com.praveenjuge.teak.core.model.MAX_TAG_NAME_LENGTH

/** Tags typed as "design, inspiration", or why they can't be added. */
internal fun parseBulkTags(text: String): Result<List<String>> {
    val tags = text.split(',').map(CardEdit::normalizeTag).filter(String::isNotEmpty).distinct()
    return when {
        tags.any { it.length > MAX_TAG_NAME_LENGTH } -> Result.failure(IllegalArgumentException("Tags can be at most $MAX_TAG_NAME_LENGTH characters."))
        tags.size > MAX_BULK_TAGS -> Result.failure(IllegalArgumentException("Choose at most $MAX_BULK_TAGS tags at a time."))
        else -> Result.success(tags)
    }
}

@Composable
internal fun AddTagsDialog(count: Int, onAdd: (List<String>) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val parsed = parseBulkTags(text)
    val error = parsed.exceptionOrNull()?.message
    val submit = { parsed.getOrNull()?.takeIf { it.isNotEmpty() }?.let(onAdd) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add tags to ${BulkCopy.cardCount(count)}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Separate tags with commas.")
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("Tags") },
                    placeholder = { Text("design, inspiration") },
                    singleLine = true,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Done),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { submit() }, enabled = parsed.getOrNull()?.isNotEmpty() == true) { Text("Add tags") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
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
        title = { Text("Add ${BulkCopy.cardCount(count)} to a folder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Find or create a folder") },
                    label = { Text("Search folders") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(visible, key = { it.id }) { folder ->
                        FolderRow(folder.name, "${folder.cardCount}", Icons.Outlined.Folder) { onPick(folder) }
                    }
                    if (canCreate) {
                        item { FolderRow("Create folder “$trimmed”", null, Icons.Outlined.CreateNewFolder) { onCreate(trimmed) } }
                    }
                    if (visible.isEmpty() && !canCreate) {
                        item {
                            Text(
                                if (folders.isEmpty()) "No folders yet. Type a name to create one." else "No folder by that name.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
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
        title = { Text("Save as smart folder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Shows every card that matches the search, including cards you save later.")
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    placeholder = { Text("Reading list") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                Text(search, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(name) }, enabled = name.isNotBlank()) { Text("Save smart folder") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
