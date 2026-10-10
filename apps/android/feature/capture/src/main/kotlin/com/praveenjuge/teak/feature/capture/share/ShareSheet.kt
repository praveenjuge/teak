package com.praveenjuge.teak.feature.capture.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

private data class ShareStatus(val title: String, val message: String, val icon: ImageVector?)

private fun ShareUiState.status(): ShareStatus = when (this) {
    ShareUiState.Resolving, ShareUiState.Saving -> ShareStatus("Saving", "Saving to your Teak vault…", null)
    ShareUiState.Saved -> ShareStatus("Saved", "It's in your library.", Icons.Filled.CheckCircle)
    ShareUiState.Empty -> ShareStatus("Nothing to Save", "There's no text, link, or file here to save.", Icons.Filled.Inbox)
    ShareUiState.SignInRequired -> ShareStatus(
        "Sign In Required",
        "Open Teak and sign in, then share again.",
        Icons.Filled.AccountCircle,
    )
    is ShareUiState.Partial -> ShareStatus(
        "Saved $saved of $total",
        detail ?: "Some items couldn't be saved.",
        Icons.Filled.Warning,
    )
    is ShareUiState.Failed -> ShareStatus("Save Failed", detail ?: "Check your connection and try again.", Icons.Filled.Error)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ShareSheet(
    state: ShareUiState,
    closeRequests: Flow<Unit>,
    onOpenTeak: () -> Unit,
    onClosed: () -> Unit,
) {
    val currentState by rememberUpdatedState(state)
    // Closing mid-save would cancel it before the files are queued, so the sheet stays until then.
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { currentState != ShareUiState.Saving },
    )
    val scope = rememberCoroutineScope()
    val close: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onClosed() }
    }
    LaunchedEffect(closeRequests) { closeRequests.collect { close() } }

    ModalBottomSheet(
        onDismissRequest = onClosed,
        sheetState = sheetState,
    ) {
        ShareSheetContent(state = state, onOpenTeak = onOpenTeak, onClose = close)
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun ShareSheetContent(state: ShareUiState, onOpenTeak: () -> Unit, onClose: () -> Unit) {
    val status = state.status()
    Column(
        modifier = Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Save to Teak",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { heading() },
        )
        Box(Modifier.heightIn(min = 56.dp), contentAlignment = Alignment.Center) {
            if (status.icon == null) {
                LoadingIndicator()
            } else {
                Icon(status.icon, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.primary)
            }
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        ) {
            Text(status.title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                status.message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        when (state) {
            ShareUiState.SignInRequired -> Button(onClick = onOpenTeak) { Text("Open Teak") }
            ShareUiState.Empty, is ShareUiState.Partial, is ShareUiState.Failed ->
                OutlinedButton(onClick = onClose) { Text("Close") }
            else -> Unit
        }
    }
}
