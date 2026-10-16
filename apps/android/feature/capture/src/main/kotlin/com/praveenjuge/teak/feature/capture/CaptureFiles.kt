package com.praveenjuge.teak.feature.capture

import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

class CaptureFileProvider : FileProvider()

internal fun newCameraPhotoUri(context: Context): Uri {
    val directory = File(context.cacheDir, "camera").apply {
        listFiles()?.forEach { it.delete() }
        mkdirs()
    }
    val file = File(directory, "capture_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.capture", file)
}

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

internal fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
