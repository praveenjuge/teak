package com.praveenjuge.teak.core.data.upload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.R
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import java.io.File

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
                    setProgressAsync(workDataOf(Output.NAME to name, KEY_PROGRESS to progress))
                    notifications.notify(NOTIFICATION_ID, notification(name, progress))
                }
            }
            cleanUp(path)
            Result.success(workDataOf(Output.NAME to name, Output.OUTCOME to UploadOutcome.Saved.name, Output.CARD_ID to cardId))
        } catch (e: TeakException) {
            if (e.code == TeakException.OFFLINE && runAttemptCount < MAX_RETRIES) return Result.retry()
            cleanUp(path)
            if (e.code == TeakException.CARD_LIMIT_REACHED) stopQueue(name, e) else continueQueue(name, e)
        }
    }

    private suspend fun stopQueue(name: String, error: TeakException): Result {
        cleanUpQueuedBehind()
        return Result.failure(failureOutput(name, UploadOutcome.LimitReached, error))
    }

    private fun continueQueue(name: String, error: TeakException): Result =
        Result.success(failureOutput(name, UploadOutcome.Failed, error))

    /**
     * The failure, with its catalog message when it has one, so the row reads in whatever language
     * the app is in when it's shown. [Output.ERROR] keeps the message as it was thrown.
     */
    private fun failureOutput(name: String, outcome: UploadOutcome, error: TeakException): Data {
        val message = (error.text as? UiText.Message)?.takeIf { text -> text.count == null && text.args.all { it is String } }
        return workDataOf(
            Output.NAME to name,
            Output.OUTCOME to outcome.name,
            Output.ERROR to ((error.text as? UiText.Verbatim)?.text ?: error.message),
            Output.ERROR_CODE to error.code,
            Output.ERROR_KEY to message?.key,
            Output.ERROR_ARGS to message?.args?.map { it as String }?.toTypedArray(),
        )
    }

    override suspend fun getForegroundInfo(): ForegroundInfo =
        foregroundInfo(inputData.getString(KEY_NAME) ?: AppLanguage.resources(applicationContext).tr("android.notification.file"), 0f)

    /**
     * Failing this upload fails every upload waiting behind it without running them, so their staged
     * copies would never be deleted. Delete them now.
     */
    private suspend fun cleanUpQueuedBehind() {
        WorkManager.getInstance(applicationContext).getWorkInfosForUniqueWorkFlow(QUEUE).first()
            .filter { it.id != id && !it.state.isFinished }
            .forEach { info ->
                info.tags.firstOrNull { it.startsWith(PATH_TAG_PREFIX) }?.let { cleanUp(it.removePrefix(PATH_TAG_PREFIX)) }
            }
    }

    private fun cleanUp(path: String) {
        StagingArea.slotOf(path)?.deleteRecursively()
    }

    private fun foregroundInfo(name: String, progress: Float): ForegroundInfo {
        ensureChannel()
        return ForegroundInfo(NOTIFICATION_ID, notification(name, progress), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private fun notification(name: String, progress: Float) =
        NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_upload)
            .setContentTitle(AppLanguage.resources(applicationContext).tr("android.notification.uploadTitle"))
            .setContentText(name)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(100, (progress * 100).toInt(), progress <= 0f)
            .build()

    /** Creating the channel again only renames it, so its name follows the app's language. */
    private fun ensureChannel() {
        notifications.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                AppLanguage.resources(applicationContext).tr("native.capture.uploads"),
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
        const val NAME_TAG_PREFIX = "teak-upload-name:"

        const val PATH_TAG_PREFIX = "teak-upload-path:"
        private const val CHANNEL_ID = "uploads"
        private const val NOTIFICATION_ID = 4101
        private const val MAX_RETRIES = 3
    }

    /** WorkManager merges each upload's output into the next one's input, so no key here may match an input key. */
    object Output {
        const val NAME = "result.name"
        const val OUTCOME = "result.outcome"
        const val CARD_ID = "result.cardId"
        const val ERROR = "result.error"
        const val ERROR_CODE = "result.errorCode"
        const val ERROR_KEY = "result.errorKey"
        const val ERROR_ARGS = "result.errorArgs"
    }
}

enum class UploadOutcome { Saved, Failed, LimitReached, NotRunAfterLimit }
