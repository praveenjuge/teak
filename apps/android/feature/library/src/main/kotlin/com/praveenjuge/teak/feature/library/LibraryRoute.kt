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
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material3.AlertDialog
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
import com.praveenjuge.teak.core.model.CardGrid
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import kotlinx.coroutines.flow.distinctUntilChanged

/** Loads the next page once one of the last few tiles is on screen, like iOS. */
private const val LOAD_MORE_THRESHOLD = 5

/** The library grid, Teak's home screen. */
@Composable
fun LibraryRoute(
    searchRequest: String?,
    onSearchRequestHandled: () -> Unit,
    selectedCardId: String?,
    onOpenCard: (String) -> Unit,
    onWriteNote: () -> Unit,
) {
    val viewModel: LibraryViewModel = hiltViewModel()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val searchState = rememberTextFieldState()

    // A tag tapped on a card arrives here and searches for it.
    LaunchedEffect(searchRequest) {
        if (searchRequest == null) return@LaunchedEffect
        if (searchRequest.isNotBlank()) searchState.setTextAndPlaceCursorAtEnd(searchRequest)
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
            onToggleFavorites = viewModel::toggleFavorites,
            onToggleTrash = viewModel::toggleTrash,
            onToggleType = viewModel::toggleType,
            onSelectHue = viewModel::selectHue,
            onClearFilters = viewModel::clearFilters,
            onLoadMore = viewModel::loadMore,
            onRefresh = viewModel::refresh,
            onBeginSelection = viewModel::beginSelection,
            onToggleSelected = viewModel::toggleSelected,
            onEndSelection = viewModel::endSelection,
            onMoveToTrash = viewModel::moveSelectedToTrash,
            onRestore = viewModel::restoreSelected,
            onDeleteForever = viewModel::deleteSelectedForever,
            onDismissBulkFailure = viewModel::dismissBulkFailure,
        ),
    )
}

/** Everything the library screen can ask for. */
internal data class LibraryActions(
    val onOpenCard: (String) -> Unit = {},
    val onWriteNote: () -> Unit = {},
    val onToggleFavorites: () -> Unit = {},
    val onToggleTrash: () -> Unit = {},
    val onToggleType: (CardType) -> Unit = {},
    val onSelectHue: (ColorHue) -> Unit = {},
    val onClearFilters: () -> Unit = {},
    val onLoadMore: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onBeginSelection: (String?) -> Unit = {},
    val onToggleSelected: (String) -> Unit = {},
    val onEndSelection: () -> Unit = {},
    val onMoveToTrash: () -> Unit = {},
    val onRestore: () -> Unit = {},
    val onDeleteForever: () -> Unit = {},
    val onDismissBulkFailure: () -> Unit = {},
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LibraryScreen(
    state: LibraryUiState,
    searchState: TextFieldState,
    selectedCardId: String?,
    actions: LibraryActions,
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    var confirmDeleteForever by rememberSaveable { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    BackHandler(enabled = state.isSelecting, onBack = actions.onEndSelection)
    LaunchedEffect(state.bulkFailure) {
        if (state.bulkFailure != null) haptics.performHapticFeedback(HapticFeedbackType.Reject)
    }

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LibraryTopBar(
                title = state.title,
                isSelecting = state.isSelecting,
                canSelect = state.paged.cards.isNotEmpty(),
                scrollBehavior = scrollBehavior,
                onSelect = { actions.onBeginSelection(null) },
                onDone = actions.onEndSelection,
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            Column(Modifier.fillMaxSize()) {
                LibrarySearchField(searchState)
                if (!state.isSelecting) {
                    LibraryFilterRow(
                        filters = state.filters,
                        onToggleFavorites = actions.onToggleFavorites,
                        onToggleTrash = actions.onToggleTrash,
                        onToggleType = actions.onToggleType,
                        onSelectHue = actions.onSelectHue,
                        onClear = actions.onClearFilters,
                    )
                }
                LibraryContent(state, selectedCardId, actions)
            }
            if (state.isSelecting) {
                SelectionToolbar(
                    inTrash = state.filters.trashOnly,
                    enabled = !state.selection.isNullOrEmpty() && !state.isRunningBulkAction,
                    onMoveToTrash = actions.onMoveToTrash,
                    onRestore = actions.onRestore,
                    onDeleteForever = { confirmDeleteForever = true },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                )
            }
        }
    }

    if (confirmDeleteForever) {
        val count = state.selection?.size ?: 0
        val noun = if (count == 1) "This card" else "$count cards"
        ConfirmDialog(
            title = "Delete Forever?",
            message = "$noun and their files will be removed. You can't undo it.",
            confirmLabel = "Delete Forever",
            onConfirm = {
                confirmDeleteForever = false
                actions.onDeleteForever()
            },
            onDismiss = { confirmDeleteForever = false },
        )
    }
    state.bulkFailure?.let { failure ->
        AlertDialog(
            onDismissRequest = actions.onDismissBulkFailure,
            title = { Text("Some cards didn't change") },
            text = { Text(failure.message) },
            confirmButton = { TextButton(onClick = actions.onDismissBulkFailure) { Text("OK") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LibraryContent(state: LibraryUiState, selectedCardId: String?, actions: LibraryActions) {
    val paged = state.paged
    when {
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
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    LibraryEmpty(state.emptyCopy, actions.onWriteNote)
                }
            } else {
                LibraryGrid(state, selectedCardId, actions)
            }
        }
    }
}

@Composable
private fun LibraryEmpty(copy: EmptyCopy?, onWriteNote: () -> Unit) {
    if (copy == null) {
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
    val icon = when (copy.kind) {
        EmptyKind.Search -> Icons.Outlined.SearchOff
        EmptyKind.Trash -> Icons.Outlined.Delete
        EmptyKind.Filters -> Icons.Outlined.FilterList
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

    // Scrolling or acting on cards puts the search keyboard away, like the system search bars.
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
                // Leaves room for the floating selection toolbar.
                bottom = if (state.isSelecting) 96.dp else 24.dp,
            ),
            verticalItemSpacing = CardGrid.GAP_DP.dp,
            horizontalArrangement = Arrangement.spacedBy(CardGrid.GAP_DP.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(cards, key = { it.id }, contentType = { it.type }) { card ->
                val selection = state.selection
                CardTile(
                    card = card,
                    selected = selection?.contains(card.id),
                    highlighted = card.id == selectedCardId,
                    onClick = {
                        focusManager.clearFocus()
                        if (selection != null) actions.onToggleSelected(card.id) else actions.onOpenCard(card.id)
                    },
                    onLongClick = {
                        focusManager.clearFocus()
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        if (selection != null) actions.onToggleSelected(card.id) else actions.onBeginSelection(card.id)
                    },
                    modifier = Modifier.animateItem(),
                )
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
