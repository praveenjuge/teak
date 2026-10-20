package com.praveenjuge.teak.feature.library

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.R as DesignR
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardGrid
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.QualifierChips
import com.praveenjuge.teak.core.model.SearchIsValue
import com.praveenjuge.teak.core.model.SearchQualifier
import com.praveenjuge.teak.core.model.Tags
import kotlinx.coroutines.flow.distinctUntilChanged

private const val LOAD_MORE_THRESHOLD = 5

@Composable
fun LibraryRoute(
    searchRequest: String?,
    onSearchRequestHandled: () -> Unit,
    selectedCardId: String?,
    onOpenCard: (String) -> Unit,
    onWriteNote: () -> Unit,
    folderId: String? = null,
    onBack: (() -> Unit)? = null,
) {
    val viewModel = hiltViewModel<LibraryViewModel, LibraryViewModel.Factory>(
        key = folderId ?: "home",
        creationCallback = { it.create(folderId) },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val searchState = rememberTextFieldState()
    var revisiting by rememberSaveable { mutableStateOf(false) }
    fun setSearch(text: String) = searchState.setTextAndPlaceCursorAtEnd(text)
    fun toggleQualifier(qualifier: SearchQualifier, on: Boolean) {
        val text = searchState.text.toString()
        setSearch(if (on) QualifierChips.add(text, qualifier) else QualifierChips.remove(text, qualifier))
    }

    LaunchedEffect(searchRequest) {
        if (searchRequest == null) return@LaunchedEffect
        if (searchRequest.isNotBlank()) setSearch(searchRequest)
        onSearchRequestHandled()
    }
    LaunchedEffect(searchState) {
        snapshotFlow { searchState.text.toString() }.collect(viewModel::onSearchChange)
    }

    LibraryScreen(
        state = state,
        searchState = searchState,
        selectedCardId = selectedCardId,
        actions = LibraryActions(
            onOpenCard = onOpenCard,
            onWriteNote = onWriteNote,
            onBack = onBack,
            onToggleFavorites = viewModel::toggleFavorites,
            onToggleArchive = viewModel::toggleArchive,
            onToggleTrash = viewModel::toggleTrash,
            onToggleDone = { toggleQualifier(SearchQualifier.Is(SearchIsValue.Done), !state.showsDone) },
            onToggleTodo = { toggleQualifier(SearchQualifier.Is(SearchIsValue.Todo), !state.showsTodo) },
            onRemoveQualifier = { toggleQualifier(it, on = false) },
            onToggleType = viewModel::toggleType,
            onSelectHue = viewModel::selectHue,
            onSort = viewModel::sort,
            onClearFilters = viewModel::clearFilters,
            onLoadMore = viewModel::loadMore,
            onRefresh = viewModel::refresh,
            onBeginSelection = viewModel::beginSelection,
            onToggleSelected = viewModel::toggleSelected,
            onEndSelection = viewModel::endSelection,
            onBulk = { viewModel.runOnSelected(it) },
            onAddTags = { viewModel.runOnSelected(BulkAction.AddTags, tags = it) },
            onAddToFolder = { viewModel.runOnSelected(BulkAction.AddToFolder, folder = it) },
            onAddToNewFolder = viewModel::addSelectedToNewFolder,
            onDeleteForever = viewModel::deleteSelectedForever,
            onArchiveCard = viewModel::setArchived,
            onRestoreCard = viewModel::restoreCard,
            onMoreLikeThis = { id -> setSearch("like:$id") },
            onRevisit = { revisiting = true },
            onSaveSearch = viewModel::saveSearchAsFolder,
            onUndo = viewModel::undo,
            onDismissMessage = viewModel::dismissMessage,
        ),
    )

    if (revisiting) {
        RevisitRoute(
            view = state.revisitQuery,
            onOpenCard = { id ->
                revisiting = false
                onOpenCard(id)
            },
            onClose = { revisiting = false },
        )
    }
}

internal data class LibraryActions(
    val onOpenCard: (String) -> Unit = {},
    val onWriteNote: () -> Unit = {},
    val onBack: (() -> Unit)? = null,
    val onToggleFavorites: () -> Unit = {},
    val onToggleArchive: () -> Unit = {},
    val onToggleTrash: () -> Unit = {},
    val onToggleDone: () -> Unit = {},
    val onToggleTodo: () -> Unit = {},
    val onRemoveQualifier: (SearchQualifier) -> Unit = {},
    val onToggleType: (CardType) -> Unit = {},
    val onSelectHue: (ColorHue) -> Unit = {},
    val onSort: (CardSort) -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onLoadMore: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onBeginSelection: (String?) -> Unit = {},
    val onToggleSelected: (String) -> Unit = {},
    val onEndSelection: () -> Unit = {},
    val onBulk: (BulkAction) -> Unit = {},
    val onAddTags: (List<String>) -> Unit = {},
    val onAddToFolder: (Folder) -> Unit = {},
    val onAddToNewFolder: (String) -> Unit = {},
    val onDeleteForever: () -> Unit = {},
    val onArchiveCard: (String, Boolean) -> Unit = { _, _ -> },
    val onRestoreCard: (String) -> Unit = {},
    val onMoreLikeThis: (String) -> Unit = {},
    val onRevisit: () -> Unit = {},
    val onSaveSearch: (String) -> Unit = {},
    val onUndo: (LibraryMessage) -> Unit = {},
    val onDismissMessage: (Long) -> Unit = {},
)

private enum class LibraryDialog { DeleteForever, AddTags, AddToFolder, SaveSearch }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LibraryScreen(
    state: LibraryUiState,
    searchState: TextFieldState,
    selectedCardId: String?,
    actions: LibraryActions,
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    var dialog by rememberSaveable { mutableStateOf<LibraryDialog?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }
    BackHandler(enabled = state.isSelecting, onBack = actions.onEndSelection)
    LaunchedEffect(state.message) {
        val message = state.message ?: return@LaunchedEffect
        // Dismiss even when leaving the screen cuts the snackbar short, so it doesn't come back later.
        try {
            val result = snackbarHostState.showSnackbar(
                message.text,
                actionLabel = if (message.undo != null) "Undo" else null,
                duration = if (message.undo != null) SnackbarDuration.Long else SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) actions.onUndo(message)
        } finally {
            actions.onDismissMessage(message.id)
        }
    }

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LibraryTopBar(
                title = state.title,
                isSelecting = state.isSelecting,
                canSelect = state.paged.cards.isNotEmpty(),
                canRevisit = state.canRevisit,
                sort = state.filters.sort,
                scrollBehavior = scrollBehavior,
                onSelect = { actions.onBeginSelection(null) },
                onDone = actions.onEndSelection,
                onSort = actions.onSort,
                onRevisit = actions.onRevisit,
                onBack = actions.onBack,
                onSaveSearch = if (state.smartFolderQuery != null) ({ dialog = LibraryDialog.SaveSearch }) else null,
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                LibrarySearchField(searchState)
                if (!state.isSelecting) {
                    LibraryFilterRow(
                        filters = state.filters,
                        showsDone = state.showsDone,
                        showsTodo = state.showsTodo,
                        onToggleFavorites = actions.onToggleFavorites,
                        onToggleArchive = actions.onToggleArchive,
                        onToggleTrash = actions.onToggleTrash,
                        onToggleDone = actions.onToggleDone,
                        onToggleTodo = actions.onToggleTodo,
                        onToggleType = actions.onToggleType,
                        onSelectHue = actions.onSelectHue,
                        onClear = actions.onClearFilters,
                    )
                    QualifierChipRow(state.chips, actions.onRemoveQualifier, Modifier.padding(top = 4.dp))
                    if (state.showsHiddenCards) HiddenCardsHeader()
                }
                LibraryContent(state, selectedCardId, actions)
            }
            if (state.isSelecting) {
                SelectionToolbar(
                    view = when {
                        state.filters.trashOnly -> SelectionView.Trash
                        state.isArchive -> SelectionView.Archive
                        else -> SelectionView.Library
                    },
                    enabled = state.pickedIds.isNotEmpty() && !state.isRunningBulkAction,
                    onAction = actions.onBulk,
                    onAddTags = { dialog = LibraryDialog.AddTags },
                    onAddToFolder = { dialog = LibraryDialog.AddToFolder },
                    onDeleteForever = { dialog = LibraryDialog.DeleteForever },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                )
            }
        }
    }

    val count = state.pickedIds.size
    when (dialog) {
        LibraryDialog.DeleteForever -> {
            val noun = if (count == 1) "This card" else "$count cards"
            ConfirmDialog(
                title = "Delete Forever?",
                message = "$noun and their files will be removed. You can't undo it.",
                confirmLabel = "Delete Forever",
                onConfirm = {
                    dialog = null
                    actions.onDeleteForever()
                },
                onDismiss = { dialog = null },
            )
        }
        LibraryDialog.AddTags -> AddTagsDialog(
            count = count,
            onAdd = {
                dialog = null
                actions.onAddTags(it)
            },
            onDismiss = { dialog = null },
        )
        LibraryDialog.AddToFolder -> FolderPickerDialog(
            count = count,
            folders = state.manualFolders,
            onPick = {
                dialog = null
                actions.onAddToFolder(it)
            },
            onCreate = {
                dialog = null
                actions.onAddToNewFolder(it)
            },
            onDismiss = { dialog = null },
        )
        LibraryDialog.SaveSearch -> SaveSearchDialog(
            search = state.search,
            onSave = {
                dialog = null
                actions.onSaveSearch(it)
            },
            onDismiss = { dialog = null },
        )
        null -> Unit
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LibraryContent(state: LibraryUiState, selectedCardId: String?, actions: LibraryActions) {
    val paged = state.paged
    when {
        state.folderMissing -> EmptyState(
            title = "Folder not found",
            message = "It may have been deleted.",
            icon = Icons.Outlined.Folder,
            action = actions.onBack?.let { back -> { Button(onClick = back) { Text("Go back") } } },
        )
        paged.isLoading && paged.cards.isEmpty() -> TeakLoading()
        paged.error != null && paged.cards.isEmpty() -> EmptyState(
            title = "Couldn't Load Cards",
            message = "Check your connection and try again.",
            icon = Icons.Outlined.CloudOff,
            action = { Button(onClick = actions.onRefresh) { Text("Try Again") } },
        )
        else -> PullToRefreshBox(
            isRefreshing = paged.isRefreshing,
            onRefresh = actions.onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            if (paged.cards.isEmpty()) {
                // Scrollable so pull to refresh still works on an empty screen.
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    LibraryEmpty(state.emptyState, actions.onWriteNote)
                    if (state.hasHiddenCards) {
                        Text(
                            Tags.HIDDEN_CARDS_HINT,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 32.dp),
                        )
                    }
                }
            } else {
                LibraryGrid(state, selectedCardId, actions)
            }
        }
    }
}

@Composable
private fun LibraryEmpty(emptyState: LibraryEmptyState, onWriteNote: () -> Unit) {
    val copy = when (emptyState) {
        is LibraryEmptyState.NoMatches -> emptyState.copy
        LibraryEmptyState.FirstCard -> {
            EmptyState(
                title = "Let's add your first card!",
                message = "Save notes, links, photos, and voice memos. They'll show up here.",
                icon = ImageVector.vectorResource(DesignR.drawable.teak_logo),
                action = {
                    Button(onClick = onWriteNote) {
                        Icon(Icons.Outlined.EditNote, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                        Text("Write a Note")
                    }
                },
            )
            return
        }
    }
    val icon = when (copy.kind) {
        EmptyKind.Search -> Icons.Outlined.SearchOff
        EmptyKind.Trash -> Icons.Outlined.Delete
        EmptyKind.Filters -> Icons.Outlined.FilterList
        EmptyKind.Archive -> Icons.Outlined.Archive
        EmptyKind.Folder -> Icons.Outlined.Folder
        EmptyKind.Similar -> Icons.Outlined.AutoAwesome
    }
    EmptyState(title = copy.title, message = copy.message, icon = icon)
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun LibraryGrid(state: LibraryUiState, selectedCardId: String?, actions: LibraryActions) {
    val cards = state.paged.cards
    val gridState = rememberLazyStaggeredGridState()
    val haptics = LocalHapticFeedback.current
    val focusManager = LocalFocusManager.current
    var menuCardId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(gridState) {
        snapshotFlow { gridState.isScrollInProgress }.collect { scrolling -> if (scrolling) focusManager.clearFocus() }
    }

    LaunchedEffect(gridState, cards.size) {
        snapshotFlow { gridState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 }
            .distinctUntilChanged()
            .collect { last -> if (last >= cards.size - LOAD_MORE_THRESHOLD) actions.onLoadMore() }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Fixed(CardGrid.columnCount(maxWidth.value)),
            state = gridState,
            contentPadding = PaddingValues(
                start = CardGrid.EDGE_DP.dp,
                end = CardGrid.EDGE_DP.dp,
                top = 8.dp,
                bottom = if (state.isSelecting) 96.dp else 24.dp,
            ),
            verticalItemSpacing = CardGrid.GAP_DP.dp,
            horizontalArrangement = Arrangement.spacedBy(CardGrid.GAP_DP.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(cards, key = { it.id }, contentType = { it.type }) { card ->
                val selecting = state.isSelecting
                val menu = tileMenu(card, inTrash = state.filters.trashOnly, actions)
                Box(Modifier.animateItem()) {
                    CardTile(
                        card = card,
                        selection = state.selection.tileSelection(card.id),
                        highlighted = card.id == selectedCardId,
                        onClick = {
                            focusManager.clearFocus()
                            if (selecting) actions.onToggleSelected(card.id) else actions.onOpenCard(card.id)
                        },
                        onLongClick = {
                            focusManager.clearFocus()
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            if (selecting) actions.onToggleSelected(card.id) else menuCardId = card.id
                        },
                        actions = menu.map { item -> CustomAccessibilityAction(item.label) { item.onClick(); true } },
                    )
                    DropdownMenu(expanded = menuCardId == card.id, onDismissRequest = { menuCardId = null }) {
                        menu.forEach { item ->
                            DropdownMenuItem(
                                text = { Text(item.label) },
                                leadingIcon = { Icon(item.icon, contentDescription = null) },
                                onClick = {
                                    menuCardId = null
                                    item.onClick()
                                },
                            )
                        }
                    }
                }
            }
            if (state.paged.isLoadingMore) {
                item(span = StaggeredGridItemSpan.FullLine) {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        LoadingIndicator(Modifier.semantics { contentDescription = "Loading more cards" })
                    }
                }
            } else if (state.paged.error != null) {
                item(span = StaggeredGridItemSpan.FullLine) { LoadMoreFailed(actions.onRefresh) }
            }
        }
    }
}

@Composable
private fun LoadMoreFailed(onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(16.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Couldn't load more cards.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = onRetry) { Text("Try Again") }
    }
}

internal class TileMenuItem(val label: String, val icon: ImageVector, val onClick: () -> Unit)

/** A tile's long-press menu, also offered to TalkBack as custom actions. */
internal fun tileMenu(card: CardSummary, inTrash: Boolean, actions: LibraryActions): List<TileMenuItem> = buildList {
    add(TileMenuItem("Select", Icons.Outlined.CheckCircle) { actions.onBeginSelection(card.id) })
    if (inTrash) {
        add(TileMenuItem("Restore", Icons.Outlined.Restore) { actions.onRestoreCard(card.id) })
        return@buildList
    }
    if (card.archived) {
        add(TileMenuItem("Unarchive", Icons.Outlined.Unarchive) { actions.onArchiveCard(card.id, false) })
    } else {
        add(TileMenuItem("Archive", Icons.Outlined.Archive) { actions.onArchiveCard(card.id, true) })
    }
    add(TileMenuItem("More like this", Icons.Outlined.AutoAwesome) { actions.onMoreLikeThis(card.id) })
}

@Composable
private fun HiddenCardsHeader() {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.VisibilityOff, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Text("Shows hidden cards", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
