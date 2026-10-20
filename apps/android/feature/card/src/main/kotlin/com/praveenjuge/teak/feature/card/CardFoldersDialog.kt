package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
import androidx.compose.foundation.clickable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.model.Folder

/** The folders one card is in: check to add, uncheck to remove, or type a name to make a new one. */
@Composable
internal fun CardFoldersDialog(
    folders: List<Folder>,
    initial: List<String>,
    onSave: (List<String>) -> Unit,
    onCreate: (String, (Folder) -> Unit) -> Unit,
    onDismiss: () -> Unit,
) {
    var checked by rememberSaveable { mutableStateOf(initial) }
    var query by rememberSaveable { mutableStateOf("") }
    val trimmed = query.trim()
    val visible = folders.filter { trimmed.isEmpty() || it.name.contains(trimmed, ignoreCase = true) }
    val canCreate = trimmed.isNotEmpty() && folders.none { it.name.equals(trimmed, ignoreCase = true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Folders") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when (checked.size) {
                        0 -> "This card isn't in a folder."
                        1 -> "In 1 folder."
                        else -> "In ${checked.size} folders."
                    },
                )
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Search folders") },
                    placeholder = { Text("Find or create a folder") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(visible, key = { it.id }) { folder ->
                        val on = folder.id in checked
                        ListItem(
                            headlineContent = { Text(folder.name) },
                            leadingContent = { Checkbox(checked = on, onCheckedChange = null) },
                            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                            modifier = Modifier.toggleable(value = on, role = Role.Checkbox) { now ->
                                checked = if (now) checked + folder.id else checked - folder.id
                            },
                        )
                    }
                    if (canCreate) {
                        item {
                            ListItem(
                                headlineContent = { Text("Create folder “$trimmed”") },
                                leadingContent = { Icon(Icons.Outlined.CreateNewFolder, contentDescription = null) },
                                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                modifier = Modifier.clickable {
                                    onCreate(trimmed) { folder -> checked = checked + folder.id }
                                    query = ""
                                },
                            )
                        }
                    }
                    if (visible.isEmpty() && !canCreate) {
                        item {
                            Text(
                                if (folders.isEmpty()) "No folders yet. Type a name to create one." else "No folder by that name.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(checked) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
