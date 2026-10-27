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
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import com.praveenjuge.teak.core.i18n.tr
import java.text.NumberFormat
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD
import com.praveenjuge.teak.core.designsystem.component.ListGroup
import com.praveenjuge.teak.core.designsystem.component.ListRow
import com.praveenjuge.teak.core.designsystem.component.ListSectionHeader
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth

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

    var waitingForNotificationPrompt by rememberSaveable(stateSaver = UriListSaver) { mutableStateOf(null) }
    var askedForNotifications by rememberSaveable { mutableStateOf(false) }
    var cameraUri by rememberSaveable { mutableStateOf<Uri?>(null) }
    var cameraAlert by rememberSaveable { mutableStateOf<CameraAlert?>(null) }

    fun upload(uris: List<Uri>) = viewModel.upload(uris) { uri -> mediaFacts(appContext, uri) }

    val notificationPrompt = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
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
            title = { Text(tr("native.capture.cameraOff")) },
            text = { Text(tr("native.capture.cameraOffMessage")) },
            confirmButton = {
                TextButton(onClick = {
                    cameraAlert = null
                    openAppSettings(context)
                }) { Text(tr("native.capture.openSettings")) }
            },
            dismissButton = { TextButton(onClick = { cameraAlert = null }) { Text(tr("common.cancel")) } },
        )
        CameraAlert.Unavailable -> MessageDialog(
            title = tr("native.capture.noCameraApp"),
            message = tr("native.capture.noCameraAppMessage"),
            onDismiss = { cameraAlert = null },
        )
        null -> Unit
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
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
            LargeFlexibleTopAppBar(
                title = { Text(tr("native.app.nav.add"), modifier = Modifier.semantics { heading() }) },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().wrapContentWidth().widthIn(max = 720.dp),
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
        ) {
            item { ListSectionHeader(tr("native.capture.write")) }
            item {
                ListGroup {
                    ListRow(tr("native.capture.noteOrLink"), Icons.Filled.EditNote, onClick = onWriteNote)
                    ListRow(tr("native.capture.voiceMemo"), Icons.Filled.Mic, onClick = onRecordVoice)
                }
            }
            item { ListSectionHeader(tr("native.capture.upload")) }
            item {
                ListGroup {
                    val enabled = !state.isPreparing
                    ListRow(tr("native.capture.photosAndVideos"), Icons.Filled.PhotoLibrary, enabled = enabled, onClick = onPickMedia)
                    ListRow(tr("native.capture.camera"), Icons.Filled.PhotoCamera, enabled = enabled, onClick = onTakePhoto)
                    ListRow(tr("native.capture.files"), Icons.Filled.Folder, enabled = enabled, onClick = onPickFiles)
                }
            }
            if (state.uploads.isNotEmpty()) {
                item {
                    ListSectionHeader(tr("native.capture.uploads")) {
                        if (state.hasFinishedUploads) TextButton(onClick = onClearFinished) { Text(tr("native.capture.clear")) }
                    }
                }
                items(state.uploads, key = { it.id }) { upload -> UploadRow(upload) }
            }
        }
    }

    when (val alert = state.alert) {
        AddAlert.TooManyFiles -> MessageDialog(
            title = tr("native.capture.tooManyFiles"),
            message = tr("native.capture.chooseUpTo", formatCount(MAX_FILES_PER_UPLOAD)),
            onDismiss = onDismissAlert,
        )
        is AddAlert.Skipped -> {
            val lines = alert.files.map { tr("native.capture.skippedFile", it.name, it.reasonText) }
            MessageDialog(
                title = tr("native.capture.someSkipped"),
                message = lines.joinToString("\n"),
                onDismiss = onDismissAlert,
            )
        }
        null -> Unit
    }
}

/** A count written the way the app's language writes numbers. */
@Composable
internal fun formatCount(value: Int): String =
    NumberFormat.getIntegerInstance(LocalConfiguration.current.locales[0]).format(value)

@Composable
private fun MessageDialog(title: String, message: String, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr("native.app.ok")) } },
    )
}
