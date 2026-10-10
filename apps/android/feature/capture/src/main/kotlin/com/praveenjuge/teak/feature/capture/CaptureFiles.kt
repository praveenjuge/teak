package com.praveenjuge.teak.feature.capture

import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/** Hands the camera app a file in Teak's cache to write the photo into. */
class CaptureFileProvider : FileProvider()

/** A fresh file for the next camera photo. Earlier photos were already copied into the upload queue. */
internal fun newCameraPhotoUri(context: Context): Uri {
    val directory = File(context.cacheDir, "camera").apply {
        listFiles()?.forEach { it.delete() }
        mkdirs()
    }
    val file = File(directory, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.capture", file)
}

/** A video's length in seconds, which the server keeps with the card, like iOS sends it. */
internal fun mediaFacts(context: Context, uri: Uri): Map<String, Double> {
    val type = context.contentResolver.getType(uri) ?: return emptyMap()
    if (!type.startsWith("video/")) return emptyMap()
    return runCatching {
        MediaMetadataRetriever().use { retriever ->
            retriever.setDataSource(context, uri)
            val millis = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull()
            if (millis == null) emptyMap() else mapOf("duration" to millis / 1000)
        }
    }.getOrDefault(emptyMap())
}

/** Opens Teak's page in system settings, where a denied permission can be turned back on. */
internal fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
