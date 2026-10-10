package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import kotlinx.coroutines.launch

/** A card's full detail: its preview, notes, tags, summary and info, with every card action. */
@Composable
fun CardDetailRoute(cardId: String, onBack: () -> Unit, onEdit: () -> Unit, onSearchTag: (String) -> Unit) {
    val viewModel = hiltViewModel<CardDetailViewModel, CardDetailViewModel.Factory>(
        key = cardId,
        creationCallback = { it.create(cardId) },
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val currentOnBack by rememberUpdatedState(onBack)

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                CardDetailEvent.Close -> currentOnBack()
                is CardDetailEvent.Message -> scope.launch { snackbarHostState.showSnackbar(event.text) }
                is CardDetailEvent.ShareFile -> context.shareFile(event)
            }
        }
    }

    CardDetailScreen(
        state = state,
        snackbarHostState = snackbarHostState,
        callbacks = CardDetailCallbacks(
            onBack = onBack,
            onEdit = onEdit,
            onSearchTag = onSearchTag,
            onToggleFavorite = viewModel::toggleFavorite,
            onMoveToTrash = viewModel::moveToTrash,
            onRestore = viewModel::restore,
            onDeleteForever = viewModel::deleteForever,
            onShareFile = viewModel::shareFile,
            onDownload = viewModel::download,
        ),
    )
}

/** Edits a card's content, notes and tags. [onDone] runs after saving or closing. */
@Composable
fun CardEditRoute(cardId: String, onDone: () -> Unit) {
    val viewModel = hiltViewModel<CardEditViewModel, CardEditViewModel.Factory>(
        key = cardId,
        creationCallback = { it.create(cardId) },
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val currentOnDone by rememberUpdatedState(onDone)

    LaunchedEffect(viewModel) {
        viewModel.done.collect { currentOnDone() }
    }

    CardEditScreen(
        state = state,
        callbacks = CardEditCallbacks(
            onClose = onDone,
            onSave = viewModel::save,
            onContentChange = viewModel::updateContent,
            onNotesChange = viewModel::updateNotes,
            onNewTagChange = viewModel::updateNewTag,
            onAddTag = viewModel::addTag,
            onRemoveTag = viewModel::removeTag,
            onRemoveAiTag = viewModel::removeAiTag,
            onDismissAlert = viewModel::dismissAlert,
        ),
    )
}

/** The detail pane on wide windows before a card is open. */
@Composable
fun CardDetailPlaceholder() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        EmptyState(
            title = "Pick a card",
            message = "Choose a card to see it here.",
            icon = Icons.Outlined.Style,
        )
    }
}
