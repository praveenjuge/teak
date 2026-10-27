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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Tag
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
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
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import androidx.compose.ui.platform.LocalConfiguration
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
            onReload = viewModel::reload,
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
    val renameError: (String) -> UiText? = { null },
    val existingTag: (String) -> String? = { null },
    val onRetry: () -> Unit = {},
    val onDismissOperation: () -> Unit = {},
    val onReload: () -> Unit = {},
)

/** A count written the way the app's language writes numbers. */
@Composable
private fun formatCount(value: Int): String =
    NumberFormat.getIntegerInstance(LocalConfiguration.current.locales[0]).format(value)

/** What a tag change says while it runs, once it's done, and when it fails. */
@Composable
private fun TagOperation.titleText(): String {
    val target = to.orEmpty()
    val cards = total.toInt().coerceAtLeast(0)
    val done = formatCount(minOf(changed.toInt(), cards))
    return when (status) {
        TagOperationStatus.Running -> when (kind) {
            TagOperationKind.Rename -> tr("native.tags.renaming", from, target)
            TagOperationKind.Merge -> tr("native.tags.merging", from, target)
            TagOperationKind.Delete -> tr("native.tags.deleting", from)
        }
        TagOperationStatus.Completed -> when (kind) {
            TagOperationKind.Rename -> tr("native.tags.renamed", from, target)
            TagOperationKind.Merge -> tr("native.tags.merged", from, target)
            TagOperationKind.Delete -> tr("native.tags.deleted", from)
        }
        TagOperationStatus.Failed -> when (kind) {
            TagOperationKind.Rename -> tr("native.tags.renameFailed", done, count = cards)
            TagOperationKind.Merge -> tr("native.tags.mergeFailed", done, count = cards)
            TagOperationKind.Delete -> tr("native.tags.deleteFailed", done, count = cards)
        }
    }
}

@Composable
private fun TagOperation.detailText(): String {
    val cards = total.toInt().coerceAtLeast(0)
    return when (status) {
        TagOperationStatus.Running -> tr("native.tags.progress", formatCount(minOf(changed.toInt(), cards)), count = cards)
        TagOperationStatus.Completed -> tr("native.tags.changed", count = changed.toInt())
        TagOperationStatus.Failed -> tr("native.tags.tryRest")
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TagsScreen(state: TagsUiState, actions: TagsActions) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(tr("native.tags.title")) },
                navigationIcon = {
                    IconButton(onClick = actions.onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("common.back"))
                    }
                },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding.withoutBottom()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                state.operation?.let { OperationCard(it, actions) }
                TextField(
                    value = state.query,
                    onValueChange = actions.onSearch,
                    placeholder = { Text(tr("native.tags.find")) },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    singleLine = true,
                    shape = CircleShape,
                    colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
                val loading = tr("native.tags.loading")
                when {
                    state.isLoading -> TeakLoading(Modifier.semantics { contentDescription = loading })
                    state.failed -> EmptyState(
                        title = tr("native.tags.loadFailed"),
                        message = tr("native.errors.offline"),
                        icon = Icons.Outlined.CloudOff,
                        action = { Button(onClick = actions.onReload) { Text(tr("common.tryAgain")) } },
                    )
                    state.shown.isEmpty() -> EmptyState(
                        title = tr("native.tags.emptyTitle"),
                        message = tr("native.tags.emptyMessage"),
                        icon = Icons.Outlined.Tag,
                    )
                    state.visible.isEmpty() -> Text(
                        tr("native.tags.noMatch", state.query.trim()),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                    else -> LazyColumn(contentPadding = PaddingValues(bottom = padding.calculateBottomPadding() + 24.dp)) {
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
    val rowLabel = tr("native.tags.rowLabel", tag.name, count = tag.cards)
    ListItem(
        headlineContent = { Text(tag.name) },
        leadingContent = { Icon(Icons.Outlined.Tag, contentDescription = null) },
        trailingContent = {
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = tr("native.folders.moreFor", tag.name))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    listOf(
                        TagOperationKind.Rename to tr("native.folders.renameMenu"),
                        TagOperationKind.Merge to tr("native.tags.mergeMenu"),
                        TagOperationKind.Delete to tr("native.tags.deleteMenu"),
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
        supportingContent = { Text(tr("native.common.cardCount", count = tag.cards), modifier = Modifier.clearAndSetSemantics {}) },
        modifier = Modifier
            .clickable { actions.onOpenTag(tag.name) }
            .semantics { contentDescription = rowLabel },
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
            Text(operation.titleText(), style = MaterialTheme.typography.titleSmall)
            Text(operation.detailText(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (operation.status == TagOperationStatus.Running) {
                LinearProgressIndicator(
                    progress = { if (operation.total > 0) (operation.processed / operation.total).toFloat() else 0f },
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    if (operation.status == TagOperationStatus.Failed) TextButton(onClick = actions.onRetry) { Text(tr("common.retry")) }
                    TextButton(onClick = actions.onDismissOperation) { Text(tr("native.app.ok")) }
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
    val canSubmit = !state.isSaving && when (editor.kind) {
        TagOperationKind.Rename -> liveError == null && name.trim() != editor.tag.name
        TagOperationKind.Merge -> target != null
        TagOperationKind.Delete -> true
    }
    val submit = { if (canSubmit) actions.onSubmit(if (editor.kind == TagOperationKind.Merge) target else name.takeIf { editor.kind == TagOperationKind.Rename }) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(editor) { if (editor.kind == TagOperationKind.Rename) focus.requestFocus() }
    val confirm = when (editor.kind) {
        TagOperationKind.Rename -> tr("common.rename")
        TagOperationKind.Merge -> target?.let { tr("native.tags.mergeInto", it) } ?: tr("native.tags.merge")
        TagOperationKind.Delete -> tr("native.tags.deleteTag")
    }
    AlertDialog(
        onDismissRequest = actions.onClose,
        title = { Text(editor.title.resolve()) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(editor.message.resolve())
                when (editor.kind) {
                    TagOperationKind.Rename -> OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text(tr("native.tags.newName")) },
                        singleLine = true,
                        isError = error != null,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                        modifier = Modifier.focusRequester(focus),
                    )
                    TagOperationKind.Merge -> MergePicker(editor, state.shown, find, target, onFind = { find = it }, onPick = { target = it })
                    TagOperationKind.Delete -> Unit
                }
                if (error != null) Text(error.resolve(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                val existing = if (editor.kind == TagOperationKind.Rename) actions.existingTag(name) else null
                if (existing != null) {
                    TextButton(onClick = { actions.onMergeInstead(existing) }, enabled = !state.isSaving) { Text(tr("native.tags.mergeInstead", existing)) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = submit, enabled = canSubmit) {
                Text(confirm, color = if (editor.kind == TagOperationKind.Delete && canSubmit) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(onClick = actions.onClose) { Text(tr("common.cancel")) } },
    )
}

@Composable
private fun MergePicker(editor: TagEditor, tags: List<TagCount>, find: String, target: String?, onFind: (String) -> Unit, onPick: (String) -> Unit) {
    val others = tags.filter { it.name != editor.tag.name }
    val visible = others.filter { find.isBlank() || it.name.contains(find.trim(), ignoreCase = true) }.take(200)
    OutlinedTextField(
        value = find,
        onValueChange = onFind,
        placeholder = { Text(tr("native.tags.find")) },
        label = { Text(tr("native.tags.find")) },
        singleLine = true,
    )
    LazyColumn(Modifier.heightIn(max = 240.dp)) {
        items(visible, key = { it.name }) { tag ->
            ListItem(
                headlineContent = { Text(tag.name) },
                supportingContent = { Text(tr("native.common.cardCount", count = tag.cards)) },
                trailingContent = if (tag.name == target) {
                    { Icon(Icons.Filled.Check, contentDescription = tr("native.tags.selected")) }
                } else {
                    null
                },
                modifier = Modifier.clickable { onPick(tag.name) },
            )
        }
        if (visible.isEmpty()) {
            item {
                Text(
                    if (others.isEmpty()) tr("native.tags.noOthers") else tr("native.tags.noneByName"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
