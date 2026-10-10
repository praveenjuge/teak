package com.praveenjuge.teak.core.data.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.model.MAX_FILE_SIZE
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** A file that couldn't be added, and why, worded for an alert. */
data class SkippedFile(val name: String, val reason: String)

data class StageResult(val files: List<StagedFile>, val skipped: List<SkippedFile>)

/** One upload's progress, as WorkManager reports it. */
data class UploadStatus(
    val id: UUID,
    val fileName: String,
    val state: State,
    val progress: Float,
    val error: String?,
    val errorCode: String?,
) {
    enum class State { Waiting, Uploading, Saved, Failed }
}

interface UploadRepository {
    /** Copies picked or shared files into app storage so they survive until uploaded. */
    suspend fun stage(uris: List<Uri>, metadata: (Uri) -> Map<String, Double> = { emptyMap() }): StageResult

    /** Queues files to upload one after another in the background, with a progress notification. */
    fun enqueue(files: List<StagedFile>)

    val uploads: Flow<List<UploadStatus>>

    /** Forgets finished uploads once their result has been shown. */
    fun clearFinished()
}

@Singleton
class WorkManagerUploadRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) : UploadRepository {
    private val workManager get() = WorkManager.getInstance(context)

    override suspend fun stage(uris: List<Uri>, metadata: (Uri) -> Map<String, Double>): StageResult =
        withContext(Dispatchers.IO) {
            val files = mutableListOf<StagedFile>()
            val skipped = mutableListOf<SkippedFile>()
            for (uri in uris) {
                val (name, size) = describe(uri)
                if (size != null && size > MAX_FILE_SIZE) {
                    skipped += SkippedFile(name, "It's larger than 100 MB.")
                    continue
                }
                try {
                    val directory = File(context.cacheDir, "uploads/${UUID.randomUUID()}").apply { mkdirs() }
                    val target = File(directory, safeName(name))
                    val copied = context.contentResolver.openInputStream(uri)?.use { input ->
                        target.outputStream().use { output -> input.copyTo(output) }
                    } ?: throw IOException("Unreadable")
                    if (copied > MAX_FILE_SIZE) {
                        directory.deleteRecursively()
                        skipped += SkippedFile(name, "It's larger than 100 MB.")
                        continue
                    }
                    files += StagedFile(target.path, target.name, mimeType(uri, target.name), copied, metadata(uri))
                } catch (e: IOException) {
                    skipped += SkippedFile(name, "Teak couldn't read it.")
                } catch (e: SecurityException) {
                    skipped += SkippedFile(name, "Teak couldn't read it.")
                }
            }
            StageResult(files, skipped)
        }

    override fun enqueue(files: List<StagedFile>) {
        for (file in files) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(
                    workDataOf(
                        UploadWorker.KEY_PATH to file.path,
                        UploadWorker.KEY_NAME to file.fileName,
                        UploadWorker.KEY_MIME to file.mimeType,
                        UploadWorker.KEY_SIZE to file.size,
                        UploadWorker.KEY_METADATA to Json.encodeToString(file.metadata),
                    ),
                )
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .addTag(UploadWorker.TAG)
                .addTag(UploadWorker.NAME_TAG_PREFIX + file.fileName)
                .addTag(UploadWorker.PATH_TAG_PREFIX + file.path)
                .build()
            // One at a time, in order, like iOS. A full card limit stops the rest of the queue.
            workManager.enqueueUniqueWork(UploadWorker.QUEUE, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }

    override val uploads: Flow<List<UploadStatus>> =
        workManager.getWorkInfosByTagFlow(UploadWorker.TAG).map { infos -> infos.map(::status) }

    override fun clearFinished() {
        workManager.pruneWork()
    }

    private fun status(info: WorkInfo): UploadStatus {
        val output = info.outputData
        // An upload that fails with no output of its own never ran: one before it hit the card limit.
        val skipped = info.state == WorkInfo.State.FAILED && output.getString(UploadWorker.OUT_ERROR) == null
        val failed = info.state == WorkInfo.State.FAILED || output.getString(UploadWorker.OUT_ERROR) != null
        val state = when {
            info.state == WorkInfo.State.CANCELLED -> UploadStatus.State.Failed
            failed && info.state.isFinished -> UploadStatus.State.Failed
            info.state == WorkInfo.State.SUCCEEDED -> UploadStatus.State.Saved
            info.state == WorkInfo.State.RUNNING -> UploadStatus.State.Uploading
            else -> UploadStatus.State.Waiting
        }
        return UploadStatus(
            id = info.id,
            fileName = info.tags.firstOrNull { it.startsWith(UploadWorker.NAME_TAG_PREFIX) }
                ?.removePrefix(UploadWorker.NAME_TAG_PREFIX)
                ?: output.getString(UploadWorker.OUT_NAME)
                ?: "File",
            state = state,
            progress = info.progress.getFloat(UploadWorker.KEY_PROGRESS, if (state == UploadStatus.State.Saved) 1f else 0f),
            error = if (skipped) SKIPPED_AT_LIMIT else output.getString(UploadWorker.OUT_ERROR),
            errorCode = if (skipped) TeakException.CARD_LIMIT_REACHED else output.getString(UploadWorker.OUT_ERROR_CODE),
        )
    }

    private fun describe(uri: Uri): Pair<String, Long?> {
        if (uri.scheme == "file") {
            val file = File(requireNotNull(uri.path))
            return file.name to file.length()
        }
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val name = cursor.getString(0)?.takeIf { it.isNotBlank() }
                    val size = if (cursor.isNull(1)) null else cursor.getLong(1)
                    return (name ?: fallbackName(uri)) to size
                }
            }
        return fallbackName(uri) to null
    }

    private fun fallbackName(uri: Uri): String {
        val extension = context.contentResolver.getType(uri)
            ?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
        return "upload_${System.currentTimeMillis()}${extension?.let { ".$it" }.orEmpty()}"
    }

    private fun mimeType(uri: Uri, name: String): String {
        val reported = if (uri.scheme == "file") null else context.contentResolver.getType(uri)
        val fromName = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
        return when {
            reported == null || reported in GENERIC -> fromName ?: reported ?: "application/octet-stream"
            else -> reported
        }
    }

    private fun safeName(name: String): String =
        name.replace(Regex("[/\\\\]+"), "_").trim().takeUnless { it.isEmpty() || it == "." || it == ".." }
            ?: "upload_${System.currentTimeMillis()}"

    private companion object {
        const val SKIPPED_AT_LIMIT = "Not uploaded because you've reached your card limit."
        val GENERIC = setOf("application/octet-stream", "binary/octet-stream", "application/unknown", "*/*")
    }
}
