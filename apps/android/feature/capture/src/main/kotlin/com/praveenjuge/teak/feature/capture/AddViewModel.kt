package com.praveenjuge.teak.feature.capture

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.upload.SkippedFile
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.data.upload.UploadStatus
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Something the Add screen needs to tell the person about a pick. */
sealed interface AddAlert {
    data object TooManyFiles : AddAlert
    data class Skipped(val files: List<SkippedFile>) : AddAlert
}

data class AddUiState(
    val uploads: List<UploadStatus> = emptyList(),
    /** Picked files are being copied into the upload queue. */
    val isPreparing: Boolean = false,
    val alert: AddAlert? = null,
) {
    val hasFinishedUploads: Boolean
        get() = uploads.any { it.state == UploadStatus.State.Saved || it.state == UploadStatus.State.Failed }
}

@HiltViewModel
class AddViewModel @Inject constructor(
    private val uploadRepository: UploadRepository,
) : ViewModel() {
    private val preparing = MutableStateFlow(false)
    private val alert = MutableStateFlow<AddAlert?>(null)

    val uiState: StateFlow<AddUiState> =
        combine(uploadRepository.uploads, preparing, alert) { uploads, isPreparing, alert ->
            AddUiState(uploads = uploads, isPreparing = isPreparing, alert = alert)
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AddUiState())

    /** Copies picked files into app storage, reports any that can't go, and queues the rest. */
    fun upload(uris: List<Uri>, metadata: (Uri) -> Map<String, Double> = { emptyMap() }) {
        if (uris.isEmpty() || preparing.value) return
        if (uris.size > MAX_FILES_PER_UPLOAD) {
            alert.value = AddAlert.TooManyFiles
            return
        }
        preparing.value = true
        viewModelScope.launch {
            try {
                val result = uploadRepository.stage(uris, metadata)
                if (result.skipped.isNotEmpty()) alert.value = AddAlert.Skipped(result.skipped)
                if (result.files.isNotEmpty()) uploadRepository.enqueue(result.files)
            } finally {
                preparing.value = false
            }
        }
    }

    fun clearFinished() = uploadRepository.clearFinished()

    fun dismissAlert() {
        alert.value = null
    }
}
