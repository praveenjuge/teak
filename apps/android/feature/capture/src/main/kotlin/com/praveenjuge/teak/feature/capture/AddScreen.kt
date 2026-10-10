package com.praveenjuge.teak.feature.capture

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD

/** Alerts that come from the camera itself rather than from a pick. */
private enum class CameraAlert { PermissionDenied, Unavailable }

private val UriListSaver = listSaver<List<Uri>?, String>(
    save = { it.orEmpty().map(Uri::toString) },
    restore = { saved -> saved.map(Uri::parse).takeIf { it.isNotEmpty() } },
)

@Composable
fun AddRoute(onWriteNote: () -> Unit, onRecordVoice: () -> Unit) {
    val viewModel: AddViewModel = hiltViewModel()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val appContext = context.applicationContext

    // Picks waiting on the notification prompt, which is asked once, before the first upload.
    var waitingForNotificationPrompt by rememberSaveable(stateSaver = UriListSaver) { mutableStateOf(null) }
    var askedForNotifications by rememberSaveable { mutableStateOf(false) }
    var cameraUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    var cameraAlert by rememberSaveable { mutableStateOf<CameraAlert?>(null) }

    fun upload(uris: List<Uri>) = viewModel.upload(uris) { uri -> mediaFacts(appContext, uri) }

    val notificationPrompt = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        // Uploads go ahead either way; the permission only adds the progress notification.
        waitingForNotificationPrompt?.let(::upload)
        waitingForNotificationPrompt = null
    }

    fun startUpload(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val needsPrompt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !askedForNotifications &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsPrompt) {
            askedForNotifications = true
            waitingForNotificationPrompt = uris
            notificationPrompt.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            upload(uris)
        }
    }

    val pickMedia = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_FILES_PER_UPLOAD),
    ) { uris -> startUpload(uris) }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        startUpload(uris)
    }
    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val uri = cameraUri
        if (saved && uri != null) startUpload(listOf(uri))
    }

    fun launchCamera() {
        val uri = newCameraPhotoUri(context)
        cameraUri = uri
        try {
            takePicture.launch(uri)
        } catch (_: ActivityNotFoundException) {
            cameraAlert = CameraAlert.Unavailable
        }
    }

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera() else cameraAlert = CameraAlert.PermissionDenied
    }

    AddScreen(
        state = state,
        onWriteNote = onWriteNote,
        onRecordVoice = onRecordVoice,
        onPickMedia = {
            pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
        },
        onTakePhoto = {
            // Teak declares the camera permission, so the camera app only opens once it's granted.
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                launchCamera()
            } else {
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
        },
        onPickFiles = { pickFiles.launch(arrayOf("*/*")) },
        onClearFinished = viewModel::clearFinished,
        onDismissAlert = viewModel::dismissAlert,
    )

    when (cameraAlert) {
        CameraAlert.PermissionDenied -> AlertDialog(
            onDismissRequest = { cameraAlert = null },
            title = { Text("Camera access is off") },
            text = { Text("Allow camera access in Settings to take photos for Teak.") },
            confirmButton = {
                TextButton(onClick = {
                    cameraAlert = null
                    openAppSettings(context)
                }) { Text("Open Settings") }
            },
            dismissButton = { TextButton(onClick = { cameraAlert = null }) { Text("Cancel") } },
        )
        CameraAlert.Unavailable -> MessageDialog(
            title = "No camera app",
            message = "This device doesn't have an app that can take photos.",
            onDismiss = { cameraAlert = null },
        )
        null -> Unit
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AddScreen(
    state: AddUiState,
    onWriteNote: () -> Unit,
    onRecordVoice: () -> Unit,
    onPickMedia: () -> Unit,
    onTakePhoto: () -> Unit,
    onPickFiles: () -> Unit,
    onClearFinished: () -> Unit,
    onDismissAlert: () -> Unit,
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Add", modifier = Modifier.semantics { heading() }) },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
        ) {
            item { SectionHeader("Write") }
            item {
                ActionGroup {
                    ActionRow("Note or Link", Icons.Filled.EditNote, MaterialTheme.colorScheme.primaryContainer, onClick = onWriteNote)
                    ActionRow("Voice Memo", Icons.Filled.Mic, MaterialTheme.colorScheme.tertiaryContainer, onClick = onRecordVoice)
                }
            }
            item { SectionHeader("Upload") }
            item {
                ActionGroup {
                    val enabled = !state.isPreparing
                    ActionRow("Photos & Videos", Icons.Filled.PhotoLibrary, MaterialTheme.colorScheme.secondaryContainer, enabled, onPickMedia)
                    ActionRow("Camera", Icons.Filled.PhotoCamera, MaterialTheme.colorScheme.surfaceContainerHighest, enabled, onTakePhoto)
                    ActionRow("Files", Icons.Filled.Folder, MaterialTheme.colorScheme.primaryContainer, enabled, onPickFiles)
                }
            }
            if (state.uploads.isNotEmpty()) {
                item {
                    SectionHeader("Uploads") {
                        if (state.hasFinishedUploads) TextButton(onClick = onClearFinished) { Text("Clear") }
                    }
                }
                items(state.uploads, key = { it.id }) { upload -> UploadRow(upload) }
            }
        }
    }

    when (val alert = state.alert) {
        AddAlert.TooManyFiles -> MessageDialog(
            title = "Too many files",
            message = "Choose up to $MAX_FILES_PER_UPLOAD files at a time.",
            onDismiss = onDismissAlert,
        )
        is AddAlert.Skipped -> MessageDialog(
            title = "Some files were skipped",
            message = alert.files.joinToString("\n") { "${it.name}: ${it.reason}" },
            onDismiss = onDismissAlert,
        )
        null -> Unit
    }
}

@Composable
private fun MessageDialog(title: String, message: String, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}
