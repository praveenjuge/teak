package com.praveenjuge.teak.feature.capture

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr

@Composable
fun VoiceMemoRoute(onDone: () -> Unit) {
    val viewModel: VoiceMemoViewModel = hiltViewModel()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = LocalActivity.current
    val currentOnDone by rememberUpdatedState(onDone)

    var showRationale by remember { mutableStateOf(false) }
    var micDenied by rememberSaveable { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }

    fun hasMic() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micDenied = !granted
        if (granted) viewModel.start()
    }

    LaunchedEffect(viewModel) {
        viewModel.saved.collect {
            Toast.makeText(context, context.resources.tr("native.capture.voiceMemoSaved"), Toast.LENGTH_SHORT).show()
            currentOnDone()
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (hasMic()) micDenied = false }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { viewModel.pause() }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { viewModel.resume() }

    val recording = state.phase == RecordingPhase.Recording
    BackHandler(enabled = recording) { confirmDiscard = true }

    VoiceMemoScreen(
        state = state,
        micDenied = micDenied,
        onRecordToggle = {
            when {
                recording -> viewModel.stop()
                hasMic() -> viewModel.start()
                activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.RECORD_AUDIO) ->
                    showRationale = true
                else -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        },
        onOpenSettings = { openAppSettings(context) },
        onBack = { if (recording) confirmDiscard = true else onDone() },
    )

    if (showRationale) {
        AlertDialog(
            onDismissRequest = { showRationale = false },
            title = { Text(tr("native.capture.allowMic")) },
            text = { Text(tr("native.capture.micNeeded")) },
            confirmButton = {
                TextButton(onClick = {
                    showRationale = false
                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                }) { Text(tr("native.capture.continue")) }
            },
            dismissButton = { TextButton(onClick = { showRationale = false }) { Text(tr("native.capture.notNow")) } },
        )
    }
    if (confirmDiscard) {
        ConfirmDialog(
            title = tr("native.capture.discardTitle"),
            message = tr("native.capture.discardMessage"),
            confirmLabel = tr("native.capture.discard"),
            onConfirm = {
                confirmDiscard = false
                viewModel.discard()
                onDone()
            },
            onDismiss = { confirmDiscard = false },
        )
    }
    state.error?.let { message ->
        AlertDialog(
            onDismissRequest = viewModel::dismissError,
            title = { Text(tr("native.capture.couldntRecord")) },
            text = { Text(message.resolve()) },
            confirmButton = { TextButton(onClick = viewModel::dismissError) { Text(tr("native.app.ok")) } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VoiceMemoScreen(
    state: VoiceMemoUiState,
    micDenied: Boolean,
    onRecordToggle: () -> Unit,
    onOpenSettings: () -> Unit,
    onBack: () -> Unit,
) {
    val recording = state.phase == RecordingPhase.Recording
    val saving = state.phase == RecordingPhase.Saving
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(tr("native.capture.voiceMemo"), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("common.back"))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Spacer(Modifier.weight(1f))
            Text(
                formatElapsed(state.elapsedSeconds),
                style = MaterialTheme.typography.displayLarge.copy(fontFeatureSettings = "tnum"),
            )
            Text(
                when {
                    saving -> tr("common.saving")
                    recording -> tr("native.capture.recording")
                    else -> tr("native.capture.tapToRecord")
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (micDenied) {
                Text(
                    tr("native.capture.micNeeded"),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp),
                )
                OutlinedButton(onClick = onOpenSettings) { Text(tr("native.capture.openSettings")) }
            }
            Spacer(Modifier.weight(1f))
            RecordButton(recording = recording, enabled = !saving, onClick = onRecordToggle)
        }
    }
}

@Composable
private fun RecordButton(recording: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val corner by animateDpAsState(if (recording) 28.dp else 48.dp, label = "recordCorner")
    // A FAB has no disabled state, so a saving recording dims the button and reports it as disabled.
    LargeFloatingActionButton(
        onClick = { if (enabled) onClick() },
        modifier = Modifier
            .size(96.dp)
            .alpha(if (enabled) 1f else DISABLED_ALPHA)
            .semantics { if (!enabled) disabled() },
        shape = RoundedCornerShape(corner),
        containerColor = MaterialTheme.colorScheme.error,
        contentColor = MaterialTheme.colorScheme.onError,
    ) {
        Icon(
            if (recording) Icons.Filled.Stop else Icons.Filled.Mic,
            contentDescription = if (recording) tr("native.capture.stopRecording") else tr("native.capture.record"),
            modifier = Modifier.size(40.dp),
        )
    }
}

private const val DISABLED_ALPHA = 0.38f

internal fun formatElapsed(seconds: Long): String = "%02d:%02d".format(seconds / 60, seconds % 60)
