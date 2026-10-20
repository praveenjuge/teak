package com.praveenjuge.teak.feature.organize

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderSpecial
import androidx.compose.material.icons.outlined.ManageSearch
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.model.BulkCopy
import com.praveenjuge.teak.core.model.Folder

@Composable
fun FoldersRoute(onOpenFolder: (String) -> Unit) {
    val viewModel: FoldersViewModel = hiltViewModel()
    val state by viewModel.state.collectAsStateWithLifecycle()
    FoldersScreen(
        state = state,
        actions = FoldersActions(
            onOpenFolder = onOpenFolder,
            onOpenEditor = viewModel::open,
            onCloseEditor = viewModel::closeEditor,
            onSave = viewModel::save,
            onDelete = viewModel::delete,
            onRestore = viewModel::restore,
            onDismissNote = viewModel::dismissNote,
        ),
    )
}

internal data class FoldersActions(
    val onOpenFolder: (String) -> Unit = {},
    val onOpenEditor: (FolderEditor) -> Unit = {},
    val onCloseEditor: () -> Unit = {},
    val onSave: (String, String?) -> Unit = { _, _ -> },
    val onDelete: (Folder) -> Unit = {},
    val onRestore: (FolderNote) -> Unit = {},
    val onDismissNote: (Long) -> Unit = {},
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FoldersScreen(state: FoldersUiState, actions: FoldersActions) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val snackbarHostState = remember { SnackbarHostState() }
    var newMenu by remember { mutableStateOf(false) }
    LaunchedEffect(state.note) {
        val note = state.note ?: return@LaunchedEffect
        // Dismiss even when leaving the screen cuts the snackbar short, so it doesn't come back later.
        try {
            val result = snackbarHostState.showSnackbar(
                note.text,
                actionLabel = if (note.restoreId != null) "Undo" else null,
                duration = if (note.restoreId != null) SnackbarDuration.Long else SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) actions.onRestore(note)
        } finally {
            actions.onDismissNote(note.id)
        }
    }
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Folders") },
                actions = {
                    Box {
                        IconButton(onClick = { newMenu = true }) { Icon(Icons.Outlined.CreateNewFolder, contentDescription = "New folder") }
                        DropdownMenu(expanded = newMenu, onDismissRequest = { newMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("New folder") },
                                leadingIcon = { Icon(Icons.Outlined.Folder, contentDescription = null) },
                                onClick = {
                                    newMenu = false
                                    actions.onOpenEditor(FolderEditor.New(smart = false))
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("New smart folder") },
                                leadingIcon = { Icon(Icons.Outlined.FolderSpecial, contentDescription = null) },
                                onClick = {
                                    newMenu = false
                                    actions.onOpenEditor(FolderEditor.New(smart = true))
                                },
                            )
                        }
                    }
                },
                scrollBehavior = scrollBehavior,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            when {
                state.isLoading -> TeakLoading()
                state.failed -> EmptyState("Couldn't Load Folders", "Check your connection and try again.", icon = Icons.Outlined.CloudOff)
                state.folders.isEmpty() -> EmptyState(
                    title = "No folders yet",
                    message = "Group related cards. Make a folder, then add cards to it.",
                    icon = Icons.Outlined.Folder,
                    action = { Button(onClick = { actions.onOpenEditor(FolderEditor.New(smart = false)) }) { Text("New folder") } },
                )
                else -> LazyColumn(
                    Modifier.widthIn(max = 720.dp).fillMaxWidth(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                ) {
                    items(state.folders, key = { it.id }) { folder -> FolderRow(folder, actions) }
                }
            }
        }
    }
    state.editor?.let { editor ->
        FolderNameDialog(editor, error = state.editorError, saving = state.isSaving, onSave = actions.onSave, onDismiss = actions.onCloseEditor)
    }
}

@Composable
private fun FolderRow(folder: Folder, actions: FoldersActions) {
    var menu by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(folder.name) },
        supportingContent = {
            Text(if (folder.isSmart) folder.query.orEmpty() else BulkCopy.cardCount(folder.cardCount), maxLines = 1)
        },
        leadingContent = { Icon(if (folder.isSmart) Icons.Outlined.ManageSearch else Icons.Outlined.Folder, contentDescription = null) },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More for ${folder.name}") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (folder.isSmart) "Edit search…" else "Rename…") },
                        onClick = {
                            menu = false
                            actions.onOpenEditor(FolderEditor.Edit(folder))
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Delete", color = MaterialTheme.colorScheme.error) },
                        onClick = {
                            menu = false
                            actions.onDelete(folder)
                        },
                    )
                }
            }
        },
        modifier = Modifier
            .clickable { actions.onOpenFolder(folder.id) }
            .semantics { if (folder.isSmart) contentDescription = "${folder.name} (smart folder)" },
    )
}

@Composable
private fun FolderNameDialog(
    editor: FolderEditor,
    error: String?,
    saving: Boolean,
    onSave: (String, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val existing = (editor as? FolderEditor.Edit)?.folder
    var name by rememberSaveable(editor) { mutableStateOf(existing?.name.orEmpty()) }
    var query by rememberSaveable(editor) { mutableStateOf(existing?.query.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(editor.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (editor.smart) Text("Shows every card that matches the search, including cards you save later.")
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    placeholder = { Text("Reading list") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                if (editor.smart) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        label = { Text("Search") },
                        placeholder = { Text("tag:design type:link") },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    )
                }
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(name, query.takeIf { editor.smart }) }, enabled = !saving) { Text(editor.submitLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
