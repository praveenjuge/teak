package com.praveenjuge.teak.core.data.upload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.R
import com.praveenjuge.teak.core.data.convex.TeakException
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.serialization.json.Json
import java.io.File

/** Uploads one staged file with a progress notification, then deletes the staged copy. */
@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val uploader: FileUploader,
) : CoroutineWorker(context, params) {
    private val notifications = context.getSystemService(NotificationManager::class.java)

    override suspend fun doWork(): Result {
        val path = inputData.getString(KEY_PATH) ?: return Result.failure()
        val name = inputData.getString(KEY_NAME) ?: File(path).name
        val file = StagedFile(
            path = path,
            fileName = name,
            mimeType = inputData.getString(KEY_MIME) ?: "application/octet-stream",
            size = inputData.getLong(KEY_SIZE, File(path).length()),
            metadata = inputData.getString(KEY_METADATA)
                ?.let { runCatching { Json.decodeFromString<Map<String, Double>>(it) }.getOrNull() }
                .orEmpty(),
        )
        // Android can refuse a foreground service when a queued upload resumes in the background
        // (for example when the network comes back). The upload still runs, just without the notification.
        runCatching { setForeground(foregroundInfo(name, 0f)) }
        return try {
            var lastReported = -1
            val cardId = uploader.upload(file) { progress ->
                val percent = (progress * 100).toInt()
                if (percent != lastReported) {
                    lastReported = percent
                    setProgressAsync(workDataOf(OUT_NAME to name, KEY_PROGRESS to progress))
                    notifications.notify(NOTIFICATION_ID, notification(name, progress))
                }
            }
            cleanUp(path)
            Result.success(workDataOf(OUT_NAME to name, OUT_CARD_ID to cardId))
        } catch (e: TeakException) {
            if (e.code == TeakException.OFFLINE && runAttemptCount < MAX_RETRIES) return Result.retry()
            cleanUp(path)
            val output = workDataOf(OUT_NAME to name, OUT_ERROR to e.message, OUT_ERROR_CODE to e.code)
            // A full vault stops the rest of the queue; any other failure lets the next file go.
            if (e.code == TeakException.CARD_LIMIT_REACHED) Result.failure(output) else Result.success(output)
        }
    }

    override suspend fun getForegroundInfo(): ForegroundInfo =
        foregroundInfo(inputData.getString(KEY_NAME) ?: "File", 0f)

    private fun cleanUp(path: String) {
        File(path).parentFile?.takeIf { it.parentFile?.name == "uploads" }?.deleteRecursively()
    }

    private fun foregroundInfo(name: String, progress: Float): ForegroundInfo {
        ensureChannel()
        return ForegroundInfo(NOTIFICATION_ID, notification(name, progress), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private fun notification(name: String, progress: Float) =
        NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_upload)
            .setContentTitle(applicationContext.getString(R.string.upload_notification_title))
            .setContentText(name)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(100, (progress * 100).toInt(), progress <= 0f)
            .build()

    private fun ensureChannel() {
        if (notifications.getNotificationChannel(CHANNEL_ID) != null) return
        notifications.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                applicationContext.getString(R.string.upload_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    companion object {
        const val TAG = "teak-upload"
        const val QUEUE = "teak-uploads"
        const val KEY_PATH = "path"
        const val KEY_NAME = "name"
        const val KEY_MIME = "mime"
        const val KEY_SIZE = "size"
        const val KEY_METADATA = "metadata"
        const val KEY_PROGRESS = "progress"

        // Uploads run as a chain, and WorkManager merges each finished upload's output into the next
        // one's input. Output keys must never match input keys, or the next file takes this one's name.
        const val OUT_NAME = "result.name"
        const val OUT_CARD_ID = "result.cardId"
        const val OUT_ERROR = "result.error"
        const val OUT_ERROR_CODE = "result.errorCode"

        /** Tags each upload with its file name, so waiting uploads can show it. */
        const val NAME_TAG_PREFIX = "teak-upload-name:"
        private const val CHANNEL_ID = "uploads"
        private const val NOTIFICATION_ID = 4101
        private const val MAX_RETRIES = 3
    }
}
