package com.praveenjuge.teak.feature.organize

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.model.TagCount
import com.praveenjuge.teak.core.model.TagOperation
import com.praveenjuge.teak.core.model.TagOperationKind
import com.praveenjuge.teak.core.model.TagOperationStatus
import java.text.NumberFormat

@Composable
fun TagsRoute(onBack: () -> Unit, onOpenTag: (String) -> Unit) {
    val viewModel: TagsViewModel = hiltViewModel()
    val state by viewModel.state.collectAsStateWithLifecycle()
    TagsScreen(
        state = state,
        actions = TagsActions(
            onBack = onBack,
            onOpenTag = onOpenTag,
            onSearch = viewModel::search,
            onOpen = viewModel::open,
            onClose = viewModel::closeEditor,
            onSubmit = viewModel::submit,
            onMergeInstead = viewModel::mergeInstead,
            renameError = viewModel::renameError,
            existingTag = viewModel::existingTag,
            onRetry = viewModel::retry,
            onDismissOperation = viewModel::dismissOperation,
        ),
    )
}

internal data class TagsActions(
    val onBack: () -> Unit = {},
    val onOpenTag: (String) -> Unit = {},
    val onSearch: (String) -> Unit = {},
    val onOpen: (TagOperationKind, TagCount) -> Unit = { _, _ -> },
    val onClose: () -> Unit = {},
    val onSubmit: (String?) -> Unit = {},
    val onMergeInstead: (String) -> Unit = {},
    val renameError: (String) -> String? = { null },
    val existingTag: (String) -> String? = { null },
    val onRetry: () -> Unit = {},
    val onDismissOperation: () -> Unit = {},
)

private fun countLabel(count: Int) = if (count == 1) "1 card" else "${NumberFormat.getIntegerInstance().format(count)} cards"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TagsScreen(state: TagsUiState, actions: TagsActions) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Tags") },
                navigationIcon = { IconButton(onClick = actions.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                state.operation?.let { OperationCard(it, actions) }
                TextField(
                    value = state.query,
                    onValueChange = actions.onSearch,
                    placeholder = { Text("Find a tag") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    singleLine = true,
                    shape = CircleShape,
                    colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
                when {
                    state.isLoading -> TeakLoading(Modifier.semantics { contentDescription = "Loading tags" })
                    state.shown.isEmpty() -> EmptyState(
                        title = "No tags yet",
                        message = "Tags you add to cards, and the ones Teak suggests, show up here.",
                        icon = Icons.Outlined.Tag,
                    )
                    state.visible.isEmpty() -> Text(
                        "No tags match “${state.query.trim()}”.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                    else -> LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
                        items(state.visible, key = { it.name }) { tag -> TagRow(tag, actions) }
                    }
                }
            }
        }
    }
    state.editor?.let { TagEditorDialog(it, state, actions) }
}

@Composable
private fun TagRow(tag: TagCount, actions: TagsActions) {
    var menu by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(tag.name) },
        leadingContent = { Icon(Icons.Outlined.Tag, contentDescription = null) },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More for ${tag.name}") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    listOf(
                        TagOperationKind.Rename to "Rename…",
                        TagOperationKind.Merge to "Merge into…",
                        TagOperationKind.Delete to "Delete…",
                    ).forEach { (kind, label) ->
                        DropdownMenuItem(
                            text = { Text(label, color = if (kind == TagOperationKind.Delete) MaterialTheme.colorScheme.error else Color.Unspecified) },
                            onClick = {
                                menu = false
                                actions.onOpen(kind, tag)
                            },
                        )
                    }
                }
            }
        },
        supportingContent = { Text(NumberFormat.getIntegerInstance().format(tag.cards), modifier = Modifier.clearAndSetSemantics {}) },
        modifier = Modifier
            .clickable { actions.onOpenTag(tag.name) }
            .semantics { contentDescription = "${tag.name}, ${countLabel(tag.cards)}" },
    )
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun OperationCard(operation: TagOperation, actions: TagsActions) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(
            Modifier.padding(16.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(operation.title, style = MaterialTheme.typography.titleSmall)
            Text(operation.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (operation.status == TagOperationStatus.Running) {
                LinearProgressIndicator(
                    progress = { if (operation.total > 0) (operation.processed / operation.total).toFloat() else 0f },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (operation.status == TagOperationStatus.Failed) TextButton(onClick = actions.onRetry) { Text("Retry") }
                    TextButton(onClick = actions.onDismissOperation) { Text("OK") }
                }
            }
        }
    }
}

@Composable
private fun TagEditorDialog(editor: TagEditor, state: TagsUiState, actions: TagsActions) {
    var name by rememberSaveable(editor) { mutableStateOf(editor.tag.name) }
    var find by rememberSaveable(editor) { mutableStateOf("") }
    var target by rememberSaveable(editor) { mutableStateOf<String?>(null) }
    val liveError = if (editor.kind == TagOperationKind.Rename) actions.renameError(name) else null
    val error = state.editorError ?: liveError
    val confirm = when (editor.kind) {
        TagOperationKind.Rename -> "Rename"
        TagOperationKind.Merge -> target?.let { "Merge into “$it”" } ?: "Merge"
        TagOperationKind.Delete -> "Delete tag"
    }
    AlertDialog(
        onDismissRequest = actions.onClose,
        title = { Text(editor.title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(editor.message)
                when (editor.kind) {
                    TagOperationKind.Rename -> OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("New name") },
                        singleLine = true,
                        isError = error != null,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    )
                    TagOperationKind.Merge -> MergePicker(editor, state.shown, find, target, onFind = { find = it }, onPick = { target = it })
                    TagOperationKind.Delete -> Unit
                }
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                val existing = if (editor.kind == TagOperationKind.Rename) actions.existingTag(name) else null
                if (existing != null) {
                    TextButton(onClick = { actions.onMergeInstead(existing) }) { Text("Merge into “$existing” instead") }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { actions.onSubmit(if (editor.kind == TagOperationKind.Merge) target else name.takeIf { editor.kind == TagOperationKind.Rename }) },
                enabled = when (editor.kind) {
                    TagOperationKind.Rename -> liveError == null && name.trim() != editor.tag.name
                    TagOperationKind.Merge -> target != null
                    TagOperationKind.Delete -> true
                },
            ) {
                Text(confirm, color = if (editor.kind == TagOperationKind.Delete) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(onClick = actions.onClose) { Text("Cancel") } },
    )
}

@Composable
private fun MergePicker(editor: TagEditor, tags: List<TagCount>, find: String, target: String?, onFind: (String) -> Unit, onPick: (String) -> Unit) {
    val others = tags.filter { it.name != editor.tag.name }
    val visible = others.filter { find.isBlank() || it.name.contains(find.trim(), ignoreCase = true) }.take(200)
    OutlinedTextField(value = find, onValueChange = onFind, placeholder = { Text("Find a tag") }, label = { Text("Find a tag") }, singleLine = true)
    LazyColumn(Modifier.heightIn(max = 240.dp)) {
        items(visible, key = { it.name }) { tag ->
            ListItem(
                headlineContent = { Text(tag.name) },
                supportingContent = { Text(countLabel(tag.cards)) },
                trailingContent = if (tag.name == target) ({ Icon(Icons.Filled.Check, contentDescription = "Selected") }) else null,
                modifier = Modifier.clickable { onPick(tag.name) },
            )
        }
        if (visible.isEmpty()) {
            item { Text(if (others.isEmpty()) "No other tags yet." else "No tag by that name.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
