package com.praveenjuge.teak.feature.capture

import android.content.Context
import android.media.MediaRecorder
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.data.upload.StagingArea
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
import javax.inject.Inject

enum class RecordingPhase { Idle, Recording, Saving }

data class VoiceMemoUiState(
    val phase: RecordingPhase = RecordingPhase.Idle,
    val elapsedSeconds: Long = 0,
    val error: String? = null,
)

@HiltViewModel
class VoiceMemoViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val uploads: UploadRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(VoiceMemoUiState())
    val uiState: StateFlow<VoiceMemoUiState> = _uiState.asStateFlow()

    private val _saved = Channel<Unit>(Channel.BUFFERED)
    val saved: Flow<Unit> = _saved.receiveAsFlow()

    private var recorder: MediaRecorder? = null
    private var output: File? = null
    private var ticker: Job? = null
    private val stopwatch = Stopwatch()

    fun start() {
        if (_uiState.value.phase != RecordingPhase.Idle) return
        val directory = StagingArea.newSlot(context)
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
        stopwatch.reset()
        stopwatch.start()
        _uiState.value = VoiceMemoUiState(phase = RecordingPhase.Recording)
        startTicker()
    }

    fun stop() {
        val mediaRecorder = recorder ?: return
        val file = output ?: return
        if (_uiState.value.phase != RecordingPhase.Recording) return
        val seconds = stopwatch.elapsedMillis / 1000.0
        _uiState.update { it.copy(phase = RecordingPhase.Saving) }
        ticker?.cancel()
        val stopped = try {
            mediaRecorder.stop()
            true
        } catch (e: RuntimeException) {
            false
        } finally {
            mediaRecorder.release()
            recorder = null
            output = null
            stopwatch.pause()
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
        if (!stopwatch.isRunning) return
        runCatching { mediaRecorder.pause() }
        stopwatch.pause()
        ticker?.cancel()
    }

    fun resume() {
        val mediaRecorder = recorder ?: return
        if (stopwatch.isRunning || _uiState.value.phase != RecordingPhase.Recording) return
        runCatching { mediaRecorder.resume() }
        stopwatch.start()
        startTicker()
    }

    fun discard() {
        ticker?.cancel()
        recorder?.let { mediaRecorder ->
            runCatching { mediaRecorder.stop() }
            mediaRecorder.release()
        }
        output?.parentFile?.deleteRecursively()
        recorder = null
        output = null
        stopwatch.reset()
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
                val elapsedMillis = stopwatch.elapsedMillis
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
