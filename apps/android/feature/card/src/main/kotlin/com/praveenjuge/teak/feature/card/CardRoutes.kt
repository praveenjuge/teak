package com.praveenjuge.teak.feature.card

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.i18n.text
import com.praveenjuge.teak.core.i18n.tr
import kotlinx.coroutines.launch

@Composable
fun CardDetailRoute(
    cardId: String,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onSearchTag: (String) -> Unit,
    onMoreLikeThis: (String) -> Unit = {},
    onOpenCard: (String) -> Unit = {},
    onViewPdf: () -> Unit = {},
) {
    val viewModel = hiltViewModel<CardDetailViewModel, CardDetailViewModel.Factory>(
        key = cardId,
        creationCallback = { it.create(cardId) },
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val currentOnBack by rememberUpdatedState(onBack)
    val lifecycleOwner = LocalLifecycleOwner.current

    LaunchedEffect(viewModel, lifecycleOwner) {
        // Events wait in the ViewModel's channel while the app is in the background, so a share sheet never opens behind it.
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            viewModel.events.collect { event ->
                when (event) {
                    CardDetailEvent.Close -> currentOnBack()
                    is CardDetailEvent.Message -> scope.launch {
                        val result = snackbarHostState.showSnackbar(
                            resources.text(event.text),
                            actionLabel = event.undo?.let { resources.tr("common.undo") },
                            duration = if (event.undo != null) SnackbarDuration.Long else SnackbarDuration.Short,
                        )
                        if (result == SnackbarResult.ActionPerformed) event.undo?.invoke()
                    }
                    is CardDetailEvent.ShareFile -> context.shareFile(event)
                }
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
            onToggleDone = viewModel::toggleDone,
            onToggleArchived = viewModel::toggleArchived,
            onRefreshDetails = viewModel::refreshDetails,
            onMoreLikeThis = { onMoreLikeThis(cardId) },
            onOpenCard = onOpenCard,
            onSetFolders = viewModel::setFolders,
            onCreateFolder = viewModel::createFolder,
            onToggleTask = viewModel::toggleTask,
            onViewPdf = onViewPdf,
            onSaveTitle = viewModel::saveTitle,
            onEditLink = viewModel::openEditLink,
            onSaveLink = viewModel::saveLink,
            onCloseEditLink = viewModel::closeEditLink,
            onKeepTag = viewModel::keepTag,
            onRemoveSuggestedTag = viewModel::removeSuggestedTag,
        ),
    )
}

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
            onPickLink = viewModel::pickLink,
            onDismissLinkPicker = viewModel::dismissLinkPicker,
            onNotesChange = viewModel::updateNotes,
            onNewTagChange = viewModel::updateNewTag,
            onAddTag = viewModel::addTag,
            onRemoveTag = viewModel::removeTag,
            onRemoveAiTag = viewModel::removeAiTag,
            onDismissAlert = viewModel::dismissAlert,
        ),
    )
}

@Composable
fun CardDetailPlaceholder() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        EmptyState(
            title = tr("native.card.pickCard.title"),
            message = tr("native.card.pickCard.message"),
            icon = Icons.Outlined.Style,
        )
    }
}
