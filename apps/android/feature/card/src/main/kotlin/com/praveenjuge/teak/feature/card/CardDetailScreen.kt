package com.praveenjuge.teak.feature.card

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInBrowser
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FabPosition
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingToolbarDefaults
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.text
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.MarkdownListItem
import com.praveenjuge.teak.core.model.ShareTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val MaxContentWidth = 720.dp

internal class CardDetailCallbacks(
    val onBack: () -> Unit,
    val onEdit: () -> Unit,
    val onSearchTag: (String) -> Unit,
    val onToggleFavorite: () -> Unit = {},
    val onMoveToTrash: () -> Unit = {},
    val onRestore: () -> Unit = {},
    val onDeleteForever: () -> Unit = {},
    val onShareFile: () -> Unit = {},
    val onDownload: () -> Unit = {},
    val onToggleDone: () -> Unit = {},
    val onToggleArchived: () -> Unit = {},
    val onRefreshDetails: () -> Unit = {},
    val onMoreLikeThis: () -> Unit = {},
    val onOpenCard: (String) -> Unit = {},
    val onSetFolders: (List<String>) -> Unit = {},
    val onCreateFolder: (String, (Folder) -> Unit) -> Unit = { _, _ -> },
    val onToggleTask: (MarkdownListItem) -> Unit = {},
    /** Opens the card's PDF in the app's reader. */
    val onViewPdf: () -> Unit = {},
    val onSaveTitle: (String) -> Unit = {},
    val onEditLink: () -> Unit = {},
    val onSaveLink: (String) -> Unit = {},
    val onCloseEditLink: () -> Unit = {},
    val onKeepTag: (String) -> Unit = {},
    val onRemoveSuggestedTag: (String) -> Unit = {},
)

/** What a hardware key does on an open card: E archives, D marks done, R refreshes details, F favorites. */
internal enum class DetailKey { Archive, Done, Refresh, Favorite }

internal fun detailKeyAction(key: Key): DetailKey? = when (key) {
    Key.E -> DetailKey.Archive
    Key.D -> DetailKey.Done
    Key.R -> DetailKey.Refresh
    Key.F -> DetailKey.Favorite
    else -> null
}

private enum class PendingConfirm { Trash, DeleteForever, Folders }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun CardDetailScreen(
    state: CardDetailUiState,
    snackbarHostState: SnackbarHostState,
    callbacks: CardDetailCallbacks,
) {
    val card = state.card
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    val actions = rememberUiActions(snackbarHostState)
    var confirm by rememberSaveable { mutableStateOf<PendingConfirm?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(card?.id) { if (card != null) runCatching { focus.requestFocus() } }

    Scaffold(
        modifier = Modifier
            .nestedScroll(scrollBehavior.nestedScrollConnection)
            .focusRequester(focus)
            .focusable()
            .onKeyEvent { event ->
                if (card == null || card.deleted || event.type != KeyEventType.KeyDown) return@onKeyEvent false
                if (event.isCtrlPressed || event.isMetaPressed || event.isAltPressed) return@onKeyEvent false
                when (detailKeyAction(event.key)) {
                    DetailKey.Archive -> callbacks.onToggleArchived()
                    DetailKey.Done -> if (state.canMarkDone) callbacks.onToggleDone() else return@onKeyEvent false
                    DetailKey.Refresh -> callbacks.onRefreshDetails()
                    DetailKey.Favorite -> callbacks.onToggleFavorite()
                    null -> return@onKeyEvent false
                }
                true
            },
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        if (card != null && state.editsTitle) {
                            LinkTitleField(CardSheet.linkTitle(card).resolve(), callbacks.onSaveTitle)
                        } else {
                            Text(
                                card?.let { CardSheet.title(it).resolve() } ?: "",
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = callbacks.onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("common.back"))
                        }
                    },
                    actions = {
                        if (state.canMarkDone) {
                            if (state.isDone) {
                                FilledTonalButton(onClick = callbacks.onToggleDone, modifier = Modifier.semantics { selected = true }) {
                                    Icon(Icons.Filled.CheckCircle, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                                    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                                    Text(state.doneText.resolve())
                                }
                            } else {
                                OutlinedButton(onClick = callbacks.onToggleDone) {
                                    Icon(Icons.Outlined.Circle, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                                    Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                                    Text(state.doneText.resolve())
                                }
                            }
                        }
                    },
                    scrollBehavior = scrollBehavior,
                )
                if (state.isTransferring) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButtonPosition = FabPosition.Center,
        floatingActionButton = {
            when {
                card == null -> Unit
                card.deleted -> TrashToolbar(
                    onRestore = callbacks.onRestore,
                    onDeleteForever = { confirm = PendingConfirm.DeleteForever },
                )
                else -> CardToolbar(
                    card = card,
                    isFavorited = state.isFavorited,
                    isRefreshing = state.isRefreshing,
                    callbacks = callbacks,
                    actions = actions,
                    onMoveToTrash = { confirm = PendingConfirm.Trash },
                    onEditFolders = { confirm = PendingConfirm.Folders },
                )
            }
        },
    ) { padding ->
        when {
            state.isLoading -> TeakLoading(Modifier.padding(padding))
            card == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                EmptyState(
                    title = tr("native.card.unavailable.title"),
                    message = tr("native.card.unavailable.movedMessage"),
                    icon = Icons.Outlined.ErrorOutline,
                )
            }
            else -> CompositionLocalProvider(LocalCardLinks provides CardLinkContext(state.linkTargets, callbacks.onOpenCard)) {
                CardDetailContent(
                    card = card,
                    state = state,
                    callbacks = callbacks,
                    actions = actions,
                    onEditFolders = { confirm = PendingConfirm.Folders },
                    modifier = Modifier.padding(padding),
                )
            }
        }
    }

    when (confirm) {
        PendingConfirm.Trash -> ConfirmDialog(
            title = tr("native.card.moveToTrash.title"),
            message = tr("native.card.moveToTrash.message"),
            confirmLabel = tr("native.actions.moveToTrash"),
            onConfirm = {
                confirm = null
                callbacks.onMoveToTrash()
            },
            onDismiss = { confirm = null },
        )
        PendingConfirm.DeleteForever -> ConfirmDialog(
            title = tr("native.card.deleteForever.title"),
            message = tr("native.card.deleteForever.message"),
            confirmLabel = tr("native.actions.deleteForever"),
            onConfirm = {
                confirm = null
                callbacks.onDeleteForever()
            },
            onDismiss = { confirm = null },
        )
        PendingConfirm.Folders -> CardFoldersDialog(
            folders = state.folders.filterNot { it.isSmart },
            initial = card?.folderIds.orEmpty(),
            onSave = { ids ->
                confirm = null
                callbacks.onSetFolders(ids)
            },
            onCreate = callbacks.onCreateFolder,
            onDismiss = { confirm = null },
        )
        null -> Unit
    }
    if (card != null && state.isEditingLink) {
        EditLinkDialog(
            address = card.url.orEmpty(),
            error = state.linkError,
            saving = state.isSavingLink,
            onSave = callbacks.onSaveLink,
            onDismiss = callbacks.onCloseEditLink,
        )
    }
}

/** A link's title in the top bar, renamed in place as on the web. A blank title puts the old one back. */
@Composable
private fun LinkTitleField(title: String, onSave: (String) -> Unit) {
    var draft by rememberSaveable { mutableStateOf(title) }
    // The card's title the draft last followed, and the title last sent until the card reports it.
    var followed by rememberSaveable { mutableStateOf(title) }
    var sent by rememberSaveable { mutableStateOf<String?>(null) }
    // Follows a saved title unless newer typing is still waiting to be saved.
    LaunchedEffect(title) {
        if (draft == followed || draft == sent) draft = title
        if (sent == title) sent = null
        followed = title
    }
    var focused by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val label = tr("native.card.titleField.label")
    val placeholder = tr("native.card.titleField.placeholder")
    fun commit() {
        if (draft.isBlank()) {
            draft = title
        } else {
            sent = draft
            onSave(draft)
        }
    }
    BasicTextField(
        value = draft,
        onValueChange = { draft = it },
        singleLine = true,
        textStyle = LocalTextStyle.current.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus() }),
        decorationBox = { field ->
            Box {
                if (draft.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                field()
            }
        },
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = label }
            .onFocusChanged { state ->
                if (focused && !state.isFocused) commit()
                focused = state.isFocused
            },
    )
}

/** Edit link…: a new address for a link card. Saving refreshes its preview. */
@Composable
private fun EditLinkDialog(address: String, error: UiText?, saving: Boolean, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf(address) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("native.card.editLink.title")) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text(tr("native.card.editLink.label")) },
                singleLine = true,
                isError = error != null,
                supportingText = { Text(error?.resolve() ?: tr("native.card.editLink.message")) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onSave(text) }),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { onSave(text) }, enabled = !saving && text.isNotBlank()) { Text(tr("common.save")) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
}

@Composable
private fun CardDetailContent(
    card: Card,
    state: CardDetailUiState,
    callbacks: CardDetailCallbacks,
    actions: UiActions,
    onEditFolders: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val documentText = state.documentText
    val onSearchTag = callbacks.onSearchTag
    val openImage = rememberImageViewer(null)
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            modifier = Modifier
                .widthIn(max = MaxContentWidth)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            CardPreview(
                card = state.displayedCard ?: card,
                documentText = documentText,
                onCopyColor = { hex -> actions.copy(hex, UiText.of("native.card.copiedValue", hex)) },
                // PDFs open in the app's reader; other documents open in the browser.
                onViewDocument = if (CardSheet.isPdf(card)) ({ _ -> callbacks.onViewPdf() }) else actions.viewDocument,
                onToggleTask = callbacks.onToggleTask.takeUnless { card.deleted },
            )
            LinkDetailsSections(card, onOpenImage = openImage)
            NotesAndTagsSections(
                state.displayedCard ?: card,
                onSearchTag,
                suggested = if (card.deleted) null else SuggestedTagActions(callbacks.onKeepTag, callbacks.onRemoveSuggestedTag),
            )
            SummarySections(card)
            LinkedFromSection(state.backlinks, callbacks.onOpenCard)
            InfoSection(card, state.cardFolders, onOpenSource = actions.openLink, onEditFolders = onEditFolders)
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun CardToolbar(
    card: Card,
    isFavorited: Boolean,
    isRefreshing: Boolean,
    callbacks: CardDetailCallbacks,
    actions: UiActions,
    onMoveToTrash: () -> Unit,
    onEditFolders: () -> Unit,
) {
    val copyText = CardSheet.copyText(card)
    val shareTarget = CardSheet.shareTarget(card)
    val linkUrl = card.url?.trim()?.takeIf { card.type == CardType.Link && it.isNotEmpty() }
    var menuOpen by remember { mutableStateOf(false) }
    HorizontalFloatingToolbar(
        expanded = true,
        floatingActionButton = {
            FloatingToolbarDefaults.StandardFloatingActionButton(onClick = callbacks.onEdit) {
                Icon(Icons.Outlined.Edit, contentDescription = tr("common.edit"))
            }
        },
        colors = FloatingToolbarDefaults.standardFloatingToolbarColors(),
    ) {
        IconButton(
            onClick = {
                when (shareTarget) {
                    is ShareTarget.Text -> actions.shareText(shareTarget)
                    is ShareTarget.File -> callbacks.onShareFile()
                    ShareTarget.None -> Unit
                }
            },
            enabled = shareTarget != ShareTarget.None,
        ) {
            Icon(Icons.Outlined.Share, contentDescription = tr("native.actions.share"))
        }
        IconButton(onClick = callbacks.onToggleFavorite) {
            Icon(
                if (isFavorited) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = if (isFavorited) tr("native.actions.unfavorite") else tr("native.actions.favorite"),
            )
        }
        if (copyText != null) {
            IconButton(onClick = { actions.copy(copyText, UiText.of("native.card.copied")) }) {
                Icon(Icons.Outlined.ContentCopy, contentDescription = tr("common.copy"))
            }
        }
        if (linkUrl != null) {
            IconButton(onClick = { actions.openLink(linkUrl) }) {
                Icon(Icons.Outlined.OpenInBrowser, contentDescription = tr("native.actions.openLink"))
            }
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = tr("common.more"))
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                fun close(action: () -> Unit): () -> Unit = {
                    menuOpen = false
                    action()
                }
                DropdownMenuItem(
                    text = { Text(if (card.archived) tr("native.actions.unarchive") else tr("native.actions.archive")) },
                    leadingIcon = { Icon(if (card.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, contentDescription = null) },
                    trailingIcon = { Text("E", color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = close(callbacks.onToggleArchived),
                )
                if (card.type == CardType.Link) {
                    DropdownMenuItem(
                        text = { Text(tr("native.card.editLink.menu")) },
                        leadingIcon = { Icon(Icons.Outlined.EditNote, contentDescription = null) },
                        onClick = close(callbacks.onEditLink),
                    )
                }
                DropdownMenuItem(
                    text = { Text(tr("native.actions.moreLikeThis")) },
                    leadingIcon = { Icon(Icons.Outlined.AutoAwesome, contentDescription = null) },
                    onClick = close(callbacks.onMoreLikeThis),
                )
                DropdownMenuItem(
                    text = { Text(tr("native.card.folders")) },
                    leadingIcon = { Icon(Icons.Outlined.Folder, contentDescription = null) },
                    onClick = close(onEditFolders),
                )
                DropdownMenuItem(
                    text = { Text(tr("native.actions.refreshDetails")) },
                    leadingIcon = { Icon(Icons.Outlined.Refresh, contentDescription = null) },
                    enabled = !isRefreshing,
                    onClick = close(callbacks.onRefreshDetails),
                )
                if (card.fileUrl != null) {
                    DropdownMenuItem(
                        text = { Text(tr("native.actions.download")) },
                        leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            callbacks.onDownload()
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text(tr("native.actions.moveToTrash"), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Icon(Icons.Outlined.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                    onClick = {
                        menuOpen = false
                        onMoveToTrash()
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun TrashToolbar(onRestore: () -> Unit, onDeleteForever: () -> Unit) {
    HorizontalFloatingToolbar(expanded = true) {
        FilledTonalButton(onClick = onRestore) {
            Icon(Icons.Outlined.Restore, contentDescription = null)
            Text(tr("native.actions.restore"), modifier = Modifier.padding(start = 8.dp))
        }
        IconButton(
            onClick = onDeleteForever,
            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) {
            Icon(Icons.Outlined.DeleteForever, contentDescription = tr("native.actions.deleteForever"))
        }
    }
}

internal class UiActions(
    val copy: (text: String, confirmation: UiText) -> Unit,
    val shareText: (ShareTarget.Text) -> Unit,
    val openLink: (String) -> Unit,
    val viewDocument: (String) -> Unit,
)

@Composable
private fun rememberUiActions(snackbarHostState: SnackbarHostState): UiActions {
    val context = LocalContext.current
    val resources = LocalResources.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    fun show(message: String) {
        scope.launch { snackbarHostState.showSnackbar(message) }
    }
    return remember(context, resources, clipboard, scope, snackbarHostState) {
        UiActions(
            copy = { text, confirmation ->
                scope.launch {
                    try {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Teak", text)))
                        snackbarHostState.showSnackbar(resources.text(confirmation))
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbarHostState.showSnackbar(resources.tr("native.card.copyFailed"))
                    }
                }
            },
            shareText = { target -> context.shareText(target) },
            openLink = { url ->
                val safe = safeExternalUrl(url)
                when {
                    safe == null -> show(resources.tr("native.card.unsafeLink"))
                    !context.openInBrowser(safe) -> show(resources.tr("android.card.noAppForLink"))
                }
            },
            viewDocument = { url ->
                safeExternalUrl(url)?.let { CustomTabsIntent.Builder().build().launchUrl(context, it.toUri()) }
            },
        )
    }
}

private fun Context.shareText(target: ShareTarget.Text) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, target.text)
        target.subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
    }
    startActivity(Intent.createChooser(send, null))
}

internal fun Context.shareFile(event: CardDetailEvent.ShareFile) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = event.mimeType
        putExtra(Intent.EXTRA_STREAM, event.uri)
        clipData = ClipData.newRawUri(null, event.uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(send, null))
}

private fun Context.openInBrowser(url: String): Boolean = try {
    startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addCategory(Intent.CATEGORY_BROWSABLE))
    true
} catch (_: ActivityNotFoundException) {
    false
}
