package com.praveenjuge.teak.feature.card

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.praveenjuge.teak.core.model.Card
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.net.URI
import javax.inject.Inject

/** Same cap as the web's and iPhone's file text preview. */
internal const val TEXT_PREVIEW_LIMIT = 512 * 1024

private val markdownExtensions = setOf("md", "mdx", "markdown")
private val textExtensions = setOf("json", "yaml", "yml", "toml", "csv", "xml", "txt")

/** How a document's own text is shown inline, if at all. */
internal enum class TextPreviewKind { Markdown, Code }

/** Markdown files render as notes; other small text files show as monospaced text. */
internal fun textPreviewKind(card: Card): TextPreviewKind? {
    val file = card.fileMetadata ?: return null
    if ((file.fileSize ?: 0.0) > TEXT_PREVIEW_LIMIT) return null
    val extension = file.fileName?.substringAfterLast('.', "")?.lowercase().orEmpty()
    return when {
        extension in markdownExtensions -> TextPreviewKind.Markdown
        file.language != null || file.mimeType?.startsWith("text/") == true || extension in textExtensions ->
            TextPreviewKind.Code
        else -> null
    }
}

/** The URL when it's an absolute http or https link, the only kind the app opens. */
internal fun safeExternalUrl(value: String?): String? {
    val trimmed = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase()
    return trimmed.takeIf { (scheme == "http" || scheme == "https") && !uri.host.isNullOrEmpty() }
}

/** Downloads a card's files: inline text previews, files to share, and saves to Downloads. */
class CardFiles @Inject constructor(
    @ApplicationContext private val context: Context,
    private val client: OkHttpClient,
) {
    /** The file's text, or null when it can't be fetched or is over [TEXT_PREVIEW_LIMIT]. */
    suspend fun fetchText(url: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            open(url).use { response ->
                val source = response.body?.source() ?: return@use null
                // request() is false once the whole body is buffered, so anything larger is skipped.
                if (source.request(TEXT_PREVIEW_LIMIT + 1L)) null else source.buffer.readUtf8()
            }
        }.getOrNull()
    }

    /** Downloads the file into the cache and returns a content URI other apps can read. */
    suspend fun shareableUri(url: String, fileName: String): Uri = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, SHARED_DIRECTORY)
        // Only the latest shared file is kept; older ones were already handed off.
        directory.deleteRecursively()
        directory.mkdirs()
        val file = File(directory, fileName)
        open(url).use { response ->
            val body = response.body ?: throw IOException("Empty response")
            file.outputStream().use { output -> body.byteStream().copyTo(output) }
        }
        FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    /** Saves the file to the public Downloads folder. */
    suspend fun saveToDownloads(url: String, fileName: String, mimeType: String?) = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType ?: mimeTypeFor(fileName))
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Couldn't create the download")
        try {
            open(url).use { response ->
                val body = response.body ?: throw IOException("Empty response")
                val output = resolver.openOutputStream(item) ?: throw IOException("Couldn't write the download")
                output.use { body.byteStream().copyTo(it) }
            }
            resolver.update(item, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        } catch (error: Exception) {
            resolver.delete(item, null, null)
            throw error
        }
    }

    private fun open(url: String): Response {
        val response = client.newCall(Request.Builder().url(url).build()).execute()
        if (!response.isSuccessful) {
            response.close()
            throw IOException("HTTP ${response.code}")
        }
        return response
    }

    private companion object {
        const val SHARED_DIRECTORY = "shared"
    }
}

/** The MIME type for a file name's extension, or a generic binary type. */
internal fun mimeTypeFor(fileName: String): String {
    val extension = fileName.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
}
