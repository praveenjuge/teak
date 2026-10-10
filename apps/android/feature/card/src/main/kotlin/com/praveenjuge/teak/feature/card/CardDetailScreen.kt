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
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ErrorOutline
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ShareTarget
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private val MaxContentWidth = 720.dp

/** What the detail screen asks of its ViewModel and navigation. */
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
)

private enum class PendingConfirm { Trash, DeleteForever }

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

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            card?.let { CardSheet.title(it) } ?: "",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = callbacks.onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
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
                    callbacks = callbacks,
                    actions = actions,
                    onMoveToTrash = { confirm = PendingConfirm.Trash },
                )
            }
        },
    ) { padding ->
        when {
            state.isLoading -> TeakLoading(Modifier.padding(padding))
            card == null -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                EmptyState(
                    title = "Card unavailable",
                    message = "It may have been deleted or moved.",
                    icon = Icons.Outlined.ErrorOutline,
                )
            }
            else -> CardDetailContent(
                card = card,
                documentText = state.documentText,
                onSearchTag = callbacks.onSearchTag,
                actions = actions,
                modifier = Modifier.padding(padding),
            )
        }
    }

    when (confirm) {
        PendingConfirm.Trash -> ConfirmDialog(
            title = "Move to Trash?",
            message = "This card will be moved to trash.",
            confirmLabel = "Move to Trash",
            onConfirm = {
                confirm = null
                callbacks.onMoveToTrash()
            },
            onDismiss = { confirm = null },
        )
        PendingConfirm.DeleteForever -> ConfirmDialog(
            title = "Delete Forever?",
            message = "This removes the card and its files. You can't undo it.",
            confirmLabel = "Delete Forever",
            onConfirm = {
                confirm = null
                callbacks.onDeleteForever()
            },
            onDismiss = { confirm = null },
        )
        null -> Unit
    }
}

@Composable
private fun CardDetailContent(
    card: Card,
    documentText: String?,
    onSearchTag: (String) -> Unit,
    actions: UiActions,
    modifier: Modifier = Modifier,
) {
    val openImage = rememberImageViewer(null)
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            modifier = Modifier
                .widthIn(max = MaxContentWidth)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                // Room for the floating toolbar.
                .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 112.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            CardPreview(
                card = card,
                documentText = documentText,
                onCopyColor = { hex -> actions.copy(hex, "Copied $hex") },
                onViewDocument = actions.viewDocument,
            )
            LinkDetailsSections(card, onOpenImage = openImage)
            NotesAndTagsSections(card, onSearchTag)
            SummarySections(card, onSearchTag)
            InfoSection(card)
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun CardToolbar(
    card: Card,
    isFavorited: Boolean,
    callbacks: CardDetailCallbacks,
    actions: UiActions,
    onMoveToTrash: () -> Unit,
) {
    val copyText = CardSheet.copyText(card)
    val shareTarget = CardSheet.shareTarget(card)
    val linkUrl = card.url?.trim()?.takeIf { card.type == CardType.Link && it.isNotEmpty() }
    var menuOpen by remember { mutableStateOf(false) }
    HorizontalFloatingToolbar(
        expanded = true,
        floatingActionButton = {
            FloatingToolbarDefaults.StandardFloatingActionButton(onClick = callbacks.onEdit) {
                Icon(Icons.Outlined.Edit, contentDescription = "Edit")
            }
        },
        colors = FloatingToolbarDefaults.vibrantFloatingToolbarColors(),
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
            Icon(Icons.Outlined.Share, contentDescription = "Share")
        }
        IconButton(onClick = callbacks.onToggleFavorite) {
            Icon(
                if (isFavorited) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                contentDescription = if (isFavorited) "Unfavorite" else "Favorite",
            )
        }
        if (copyText != null) {
            IconButton(onClick = { actions.copy(copyText, "Copied") }) {
                Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy")
            }
        }
        if (linkUrl != null) {
            IconButton(onClick = { actions.openLink(linkUrl) }) {
                Icon(Icons.Outlined.OpenInBrowser, contentDescription = "Open in Browser")
            }
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "More")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                if (card.fileUrl != null) {
                    DropdownMenuItem(
                        text = { Text("Download") },
                        leadingIcon = { Icon(Icons.Outlined.Download, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            callbacks.onDownload()
                        },
                    )
                }
                DropdownMenuItem(
                    text = { Text("Move to Trash", color = MaterialTheme.colorScheme.error) },
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
            Text("Restore", modifier = Modifier.padding(start = 8.dp))
        }
        IconButton(
            onClick = onDeleteForever,
            colors = IconButtonDefaults.iconButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) {
            Icon(Icons.Outlined.DeleteForever, contentDescription = "Delete Forever")
        }
    }
}

/** Actions that need the Android context: the clipboard, share sheet, browser and Custom Tabs. */
internal class UiActions(
    val copy: (text: String, confirmation: String) -> Unit,
    val shareText: (ShareTarget.Text) -> Unit,
    val openLink: (String) -> Unit,
    val viewDocument: (String) -> Unit,
)

@Composable
private fun rememberUiActions(snackbarHostState: SnackbarHostState): UiActions {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    fun show(message: String) {
        scope.launch { snackbarHostState.showSnackbar(message) }
    }
    return remember(context, clipboard, scope, snackbarHostState) {
        UiActions(
            copy = { text, confirmation ->
                scope.launch {
                    try {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Teak", text)))
                        snackbarHostState.showSnackbar(confirmation)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        snackbarHostState.showSnackbar("Couldn't copy to the clipboard.")
                    }
                }
            },
            shareText = { target -> context.shareText(target) },
            openLink = { url ->
                val safe = safeExternalUrl(url)
                when {
                    safe == null -> show("This link looks unsafe to open.")
                    !context.openInBrowser(safe) -> show("No app can open this link.")
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

/** Hands a downloaded file to the share sheet with read access. */
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
