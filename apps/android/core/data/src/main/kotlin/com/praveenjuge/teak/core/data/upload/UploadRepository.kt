package com.praveenjuge.teak.core.data.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.MAX_FILE_SIZE
import com.praveenjuge.teak.core.model.UiText
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

object StagingArea {
    private const val DIRECTORY = "uploads"

    fun newSlot(context: Context): File = File(context.cacheDir, "$DIRECTORY/${UUID.randomUUID()}").apply { mkdirs() }

    internal fun slotOf(path: String): File? = File(path).parentFile?.takeIf { it.parentFile?.name == DIRECTORY }
}

/** A file that wasn't staged, and why, in the app's language. */
data class SkippedFile(val name: String, val reasonText: UiText) {
    companion object {
        fun tooLarge(name: String) = SkippedFile(name, UiText.of("native.errors.fileTooLargeSkipped"))

        fun unreadable(name: String) = SkippedFile(name, UiText.of("native.errors.unreadableFile"))
    }
}

data class StageResult(val files: List<StagedFile>, val skipped: List<SkippedFile>)

data class UploadStatus(
    val id: UUID,
    val fileName: String,
    val state: State,
    val progress: Float,
    /** Why the upload failed, in the app's language where Teak has words for it. */
    val errorText: UiText?,
    val errorCode: String?,
) {
    enum class State { Waiting, Uploading, Saved, Failed }
}

interface UploadRepository {
    suspend fun stage(uris: List<Uri>, metadata: (Uri) -> Map<String, Double> = { emptyMap() }): StageResult

    fun enqueue(files: List<StagedFile>)

    val uploads: Flow<List<UploadStatus>>

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
                    skipped += SkippedFile.tooLarge(name)
                    continue
                }
                try {
                    val directory = StagingArea.newSlot(context)
                    val target = File(directory, safeName(name))
                    val copied = context.contentResolver.openInputStream(uri)?.use { input ->
                        target.outputStream().use { output -> input.copyTo(output) }
                    } ?: throw IOException("Unreadable")
                    if (copied > MAX_FILE_SIZE) {
                        directory.deleteRecursively()
                        skipped += SkippedFile.tooLarge(name)
                        continue
                    }
                    files += StagedFile(target.path, target.name, mimeType(uri, target.name), copied, metadata(uri))
                } catch (e: IOException) {
                    skipped += SkippedFile.unreadable(name)
                } catch (e: SecurityException) {
                    skipped += SkippedFile.unreadable(name)
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
        val outcome = uploadOutcome(info.state, output)
        val skipped = outcome == UploadOutcome.NotRunAfterLimit
        val state = when {
            info.state == WorkInfo.State.CANCELLED -> UploadStatus.State.Failed
            outcome != null && outcome != UploadOutcome.Saved -> UploadStatus.State.Failed
            info.state == WorkInfo.State.SUCCEEDED -> UploadStatus.State.Saved
            info.state == WorkInfo.State.RUNNING -> UploadStatus.State.Uploading
            else -> UploadStatus.State.Waiting
        }
        return UploadStatus(
            id = info.id,
            fileName = info.tags.firstOrNull { it.startsWith(UploadWorker.NAME_TAG_PREFIX) }
                ?.removePrefix(UploadWorker.NAME_TAG_PREFIX)
                ?: output.getString(UploadWorker.Output.NAME)
                ?: AppLanguage.resources(context).tr("android.notification.file"),
            state = state,
            progress = info.progress.getFloat(UploadWorker.KEY_PROGRESS, if (state == UploadStatus.State.Saved) 1f else 0f),
            errorText = if (skipped) UiText.of("native.errors.skippedAtLimit") else failureText(output),
            errorCode = if (skipped) TeakException.CARD_LIMIT_REACHED else output.getString(UploadWorker.Output.ERROR_CODE),
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
        val GENERIC = setOf("application/octet-stream", "binary/octet-stream", "application/unknown", "*/*")
    }
}

/**
 * What a failed upload says: the catalog message the worker recorded, else the words for its code,
 * else its message as the server wrote it (rows from before the worker recorded messages).
 */
internal fun failureText(output: Data): UiText? {
    output.getString(UploadWorker.Output.ERROR_KEY)?.let { key ->
        return UiText.Message(key, args = output.getStringArray(UploadWorker.Output.ERROR_ARGS).orEmpty().toList())
    }
    return output.getString(UploadWorker.Output.ERROR_CODE)?.let(TeakException::textFor)
        ?: output.getString(UploadWorker.Output.ERROR)?.let(UiText::verbatim)
}

/**
 * Rows a worker wrote before [UploadWorker.Output.OUTCOME] existed can outlive an app update,
 * so their outcome is read from the error they carry and the state the old worker ended in.
 */
internal fun uploadOutcome(state: WorkInfo.State, output: Data): UploadOutcome? {
    output.getString(UploadWorker.Output.OUTCOME)?.let { return UploadOutcome.valueOf(it) }
    val hasError = output.getString(UploadWorker.Output.ERROR) != null
    return when {
        state == WorkInfo.State.FAILED && hasError -> UploadOutcome.LimitReached
        state == WorkInfo.State.FAILED -> UploadOutcome.NotRunAfterLimit
        state.isFinished && hasError -> UploadOutcome.Failed
        else -> null
    }
}
