package com.praveenjuge.teak.feature.organize

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import androidx.compose.ui.platform.LocalContext
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.text
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.UiText

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
            onReload = viewModel::reload,
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
    val onReload: () -> Unit = {},
)

/** The Scaffold's padding on every side but the bottom, which a list scrolls under through its content padding instead. */
@Composable
internal fun PaddingValues.withoutBottom(): PaddingValues {
    val direction = LocalLayoutDirection.current
    return PaddingValues(start = calculateStartPadding(direction), top = calculateTopPadding(), end = calculateEndPadding(direction))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FoldersScreen(state: FoldersUiState, actions: FoldersActions) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val snackbarHostState = remember { SnackbarHostState() }
    var newMenu by remember { mutableStateOf(false) }
    val resources = LocalContext.current.resources
    LaunchedEffect(state.note) {
        val note = state.note ?: return@LaunchedEffect
        // Dismiss even when leaving the screen cuts the snackbar short, so it doesn't come back later.
        try {
            val result = snackbarHostState.showSnackbar(
                resources.text(note.text),
                actionLabel = if (note.restoreId != null) resources.tr("common.undo") else null,
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
                title = { Text(tr("native.folders.title")) },
                actions = {
                    Box {
                        IconButton(onClick = { newMenu = true }) {
                            Icon(Icons.Outlined.CreateNewFolder, contentDescription = tr("native.folders.newFolder"))
                        }
                        DropdownMenu(expanded = newMenu, onDismissRequest = { newMenu = false }) {
                            DropdownMenuItem(
                                text = { Text(tr("native.folders.newFolder")) },
                                leadingIcon = { Icon(Icons.Outlined.Folder, contentDescription = null) },
                                onClick = {
                                    newMenu = false
                                    actions.onOpenEditor(FolderEditor.New(smart = false))
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(tr("native.folders.newSmartFolder")) },
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
        Box(Modifier.fillMaxSize().padding(padding.withoutBottom()), contentAlignment = Alignment.TopCenter) {
            when {
                state.isLoading -> TeakLoading()
                state.failed -> EmptyState(
                    tr("native.folders.loadFailed"),
                    tr("native.errors.offline"),
                    icon = Icons.Outlined.CloudOff,
                    action = { Button(onClick = actions.onReload) { Text(tr("common.tryAgain")) } },
                )
                state.folders.isEmpty() -> EmptyState(
                    title = tr("native.folders.emptyTitle"),
                    message = tr("native.folders.emptyMessage"),
                    icon = Icons.Outlined.Folder,
                    action = {
                        Button(onClick = { actions.onOpenEditor(FolderEditor.New(smart = false)) }) {
                            Text(tr("native.folders.newFolder"))
                        }
                    },
                )
                else -> LazyColumn(
                    Modifier.widthIn(max = 720.dp).fillMaxWidth(),
                    contentPadding = PaddingValues(bottom = padding.calculateBottomPadding() + 24.dp),
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
    // The label replaces the row's text for TalkBack, so it carries the search too.
    val smartLabel = listOf(tr("native.folders.smartLabel", folder.name), folder.query.orEmpty())
        .filter { it.isNotBlank() }
        .joinToString(", ")
    ListItem(
        headlineContent = { Text(folder.name) },
        supportingContent = {
            Text(
                if (folder.isSmart) folder.query.orEmpty() else tr("native.common.cardCount", count = folder.cardCount),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        leadingContent = { Icon(if (folder.isSmart) Icons.Outlined.ManageSearch else Icons.Outlined.Folder, contentDescription = null) },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = tr("native.folders.moreFor", folder.name))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text(if (folder.isSmart) tr("native.folders.editSearchMenu") else tr("native.folders.renameMenu")) },
                        onClick = {
                            menu = false
                            actions.onOpenEditor(FolderEditor.Edit(folder))
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(tr("common.delete"), color = MaterialTheme.colorScheme.error) },
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
            .semantics { if (folder.isSmart) contentDescription = smartLabel },
    )
}

@Composable
private fun FolderNameDialog(
    editor: FolderEditor,
    error: UiText?,
    saving: Boolean,
    onSave: (String, String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val existing = (editor as? FolderEditor.Edit)?.folder
    var name by rememberSaveable(editor) { mutableStateOf(existing?.name.orEmpty()) }
    var query by rememberSaveable(editor) { mutableStateOf(existing?.query.orEmpty()) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(editor) { focus.requestFocus() }
    val submit = { if (!saving) onSave(name, query.takeIf { editor.smart }) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(editor.title.resolve()) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (editor.smart) Text(tr("native.folders.smartMessage"))
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(tr("native.folders.name")) },
                    placeholder = { Text(tr("native.folders.namePlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = if (editor.smart) ImeAction.Next else ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.focusRequester(focus),
                )
                if (editor.smart) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        label = { Text(tr("native.folders.search")) },
                        placeholder = { Text("tag:design type:link") },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None,
                            autoCorrectEnabled = false,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                }
                if (error != null) Text(error.resolve(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = !saving) {
                Text(editor.submitLabel.resolve())
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
}
