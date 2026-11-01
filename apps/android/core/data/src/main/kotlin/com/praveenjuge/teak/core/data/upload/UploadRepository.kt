package com.praveenjuge.teak.core.data.upload

import android.content.ContentResolver
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
import androidx.work.await
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.MAX_FILE_SIZE
import com.praveenjuge.teak.core.model.UiText
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Copies wait here, outside the cache Android may clear, until their upload ends. */
object StagingArea {
    private const val DIRECTORY = "uploads"

    fun newSlot(context: Context): File = File(root(context), UUID.randomUUID().toString()).apply { mkdirs() }

    internal fun root(context: Context): File = File(context.noBackupFilesDir, DIRECTORY)

    internal fun slotOf(path: String): File? = File(path).parentFile?.takeIf { it.parentFile?.name == DIRECTORY }
}

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

    /** Cancels every queued upload and deletes the staged copies, so none reaches the next account. */
    suspend fun discardAll()

    /**
     * Deletes staged copies no upload owns: a recording or a copy the process died in the middle of. Only ones
     * older than a day go, so a recording or copy still in progress stays.
     */
    suspend fun sweepAbandoned()
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
                var name = uri.lastPathSegment ?: uri.toString()
                // Only content URIs: a file:// URI from another app could point at Teak's own private files.
                if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
                    skipped += SkippedFile.unreadable(name)
                    continue
                }
                var directory: File? = null
                try {
                    val (describedName, size) = describe(uri)
                    name = describedName
                    if (size != null && size > MAX_FILE_SIZE) {
                        skipped += SkippedFile.tooLarge(name)
                        continue
                    }
                    val slot = StagingArea.newSlot(context).also { directory = it }
                    val target = File(slot, safeName(name))
                    // A provider can leave out the size or report it wrong, so the copy stops one byte past the limit.
                    val copied = context.contentResolver.openInputStream(uri)?.use { input ->
                        target.outputStream().use { output -> input.copyAtMost(output, MAX_FILE_SIZE + 1) }
                    } ?: throw IOException("Unreadable")
                    if (copied > MAX_FILE_SIZE) {
                        slot.deleteRecursively()
                        skipped += SkippedFile.tooLarge(name)
                        continue
                    }
                    files += StagedFile(target.path, target.name, mimeType(uri, target.name), copied, metadata(uri))
                } catch (e: IOException) {
                    directory?.deleteRecursively()
                    skipped += SkippedFile.unreadable(name)
                } catch (e: SecurityException) {
                    directory?.deleteRecursively()
                    skipped += SkippedFile.unreadable(name)
                } catch (e: IllegalArgumentException) {
                    // Some providers throw this from query or open for a URI they don't recognize.
                    directory?.deleteRecursively()
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

    override suspend fun discardAll() {
        workManager.cancelUniqueWork(UploadWorker.QUEUE).await()
        workManager.pruneWork().await()
        withContext(Dispatchers.IO) { StagingArea.root(context).deleteRecursively() }
    }

    override suspend fun sweepAbandoned() {
        val owned = workManager.getWorkInfosByTagFlow(UploadWorker.TAG).first()
            .filterNot { it.state.isFinished }
            .flatMap { info -> info.tags.filter { it.startsWith(UploadWorker.PATH_TAG_PREFIX) } }
            .mapNotNull { StagingArea.slotOf(it.removePrefix(UploadWorker.PATH_TAG_PREFIX))?.path }
            .toSet()
        val cutoff = System.currentTimeMillis() - ABANDONED_AFTER_MS
        withContext(Dispatchers.IO) {
            StagingArea.root(context).listFiles().orEmpty()
                .filter { it.path !in owned && it.lastModified() < cutoff }
                .forEach { it.deleteRecursively() }
        }
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
        val reported = context.contentResolver.getType(uri)
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
        const val ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000L
        val GENERIC = setOf("application/octet-stream", "binary/octet-stream", "application/unknown", "*/*")
    }
}

private fun InputStream.copyAtMost(output: OutputStream, limit: Long): Long {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var copied = 0L
    while (copied < limit) {
        val read = read(buffer, 0, minOf(buffer.size.toLong(), limit - copied).toInt())
        if (read < 0) break
        output.write(buffer, 0, read)
        copied += read
    }
    return copied
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
