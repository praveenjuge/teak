package com.praveenjuge.teak.feature.capture

import android.content.Context
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.data.upload.UploadRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject

enum class RecordingPhase { Idle, Recording, Saving }

data class VoiceMemoUiState(
    val phase: RecordingPhase = RecordingPhase.Idle,
    val elapsedSeconds: Long = 0,
    val error: String? = null,
)

/** Records one voice memo with [MediaRecorder] and queues it for upload when it stops. */
@HiltViewModel
class VoiceMemoViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploads: UploadRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(VoiceMemoUiState())
    val uiState: StateFlow<VoiceMemoUiState> = _uiState.asStateFlow()

    private val _saved = Channel<Unit>(Channel.BUFFERED)
    /** Fires once the recording is queued to upload. */
    val saved: Flow<Unit> = _saved.receiveAsFlow()

    private var recorder: MediaRecorder? = null
    private var output: File? = null
    private var ticker: Job? = null

    // Time recorded before the current stretch, and when the current stretch started (0 while paused).
    private var recordedMillis = 0L
    private var stretchStartedAt = 0L

    private val elapsedMillis: Long
        get() = recordedMillis + if (stretchStartedAt > 0) SystemClock.elapsedRealtime() - stretchStartedAt else 0

    fun start() {
        if (_uiState.value.phase != RecordingPhase.Idle) return
        // Under cache/uploads/<id>/, so the upload worker removes it once it's uploaded.
        val directory = File(context.cacheDir, "uploads/${UUID.randomUUID()}").apply { mkdirs() }
        val file = File(directory, "recording-${System.currentTimeMillis()}.m4a")
        val mediaRecorder = MediaRecorder(context)
        try {
            mediaRecorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44_100)
                setAudioEncodingBitRate(128_000)
                setAudioChannels(1)
                setOutputFile(file.path)
                prepare()
                start()
            }
        } catch (e: IOException) {
            failToStart(mediaRecorder, directory)
            return
        } catch (e: RuntimeException) {
            failToStart(mediaRecorder, directory)
            return
        }
        recorder = mediaRecorder
        output = file
        recordedMillis = 0
        stretchStartedAt = SystemClock.elapsedRealtime()
        _uiState.value = VoiceMemoUiState(phase = RecordingPhase.Recording)
        startTicker()
    }

    /** Stops recording and queues the memo to upload in the background. */
    fun stop() {
        val mediaRecorder = recorder ?: return
        val file = output ?: return
        if (_uiState.value.phase != RecordingPhase.Recording) return
        val seconds = elapsedMillis / 1000.0
        _uiState.update { it.copy(phase = RecordingPhase.Saving) }
        ticker?.cancel()
        val stopped = try {
            mediaRecorder.stop()
            true
        } catch (e: RuntimeException) {
            // Stopping right after starting leaves no audio to keep.
            false
        } finally {
            mediaRecorder.release()
            recorder = null
            output = null
            stretchStartedAt = 0
        }
        if (!stopped || file.length() == 0L) {
            file.parentFile?.deleteRecursively()
            _uiState.value = VoiceMemoUiState(error = "That recording was too short to save. Please try again.")
            return
        }
        uploads.enqueue(listOf(StagedFile(file.path, file.name, "audio/mp4", file.length(), mapOf("duration" to seconds))))
        viewModelScope.launch { _saved.send(Unit) }
    }

    /** Apps can't hear the microphone from the background, so recording pauses while Teak is hidden. */
    fun pause() {
        val mediaRecorder = recorder ?: return
        if (stretchStartedAt == 0L) return
        runCatching { mediaRecorder.pause() }
        recordedMillis = elapsedMillis
        stretchStartedAt = 0
        ticker?.cancel()
    }

    fun resume() {
        val mediaRecorder = recorder ?: return
        if (stretchStartedAt != 0L || _uiState.value.phase != RecordingPhase.Recording) return
        runCatching { mediaRecorder.resume() }
        stretchStartedAt = SystemClock.elapsedRealtime()
        startTicker()
    }

    /** Throws away the recording in progress. */
    fun discard() {
        ticker?.cancel()
        recorder?.let { mediaRecorder ->
            runCatching { mediaRecorder.stop() }
            mediaRecorder.release()
        }
        output?.parentFile?.deleteRecursively()
        recorder = null
        output = null
        recordedMillis = 0
        stretchStartedAt = 0
        _uiState.value = VoiceMemoUiState()
    }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    override fun onCleared() {
        discard()
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker = viewModelScope.launch {
            while (isActive) {
                _uiState.update { it.copy(elapsedSeconds = elapsedMillis / 1000) }
                delay(1000 - elapsedMillis % 1000)
            }
        }
    }

    private fun failToStart(mediaRecorder: MediaRecorder, directory: File) {
        mediaRecorder.release()
        directory.deleteRecursively()
        _uiState.value = VoiceMemoUiState(error = "Teak couldn't start recording. Please try again.")
    }
}
