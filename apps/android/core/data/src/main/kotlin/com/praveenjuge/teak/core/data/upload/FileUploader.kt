package com.praveenjuge.teak.core.data.upload

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.string
import com.praveenjuge.teak.core.model.MAX_FILE_SIZE
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** A file copied into app storage, ready to upload. */
data class StagedFile(
    val path: String,
    val fileName: String,
    val mimeType: String,
    val size: Long,
    /** Extra facts the server keeps, like a video's duration. Numbers must be Doubles. */
    val metadata: Map<String, Double> = emptyMap(),
)

/**
 * Uploads one file the way every Teak client does: `uploadAndCreateCard` signs an upload URL, the
 * bytes go up in a single PUT, then `finalizeUploadedCard` creates the card from the stored file.
 */
@Singleton
class FileUploader @Inject constructor(
    private val convex: ConvexApi,
    private val httpClient: OkHttpClient,
) {
    /** Returns the new card's ID. Throws [TeakException] with the server's code on failure. */
    suspend fun upload(file: StagedFile, onProgress: (Float) -> Unit = {}): String {
        if (file.size > MAX_FILE_SIZE) {
            throw TeakException(TeakException.FILE_TOO_LARGE, "File is too large. Maximum file size is 100MB.")
        }
        val metadata = file.metadata.takeIf { it.isNotEmpty() }
        val prepared = convex.mutation(
            "cards:uploadAndCreateCard",
            buildMap {
                put("fileName", file.fileName)
                put("fileType", file.mimeType)
                put("fileSize", file.size.toDouble())
                metadata?.let { put("additionalMetadata", it) }
            },
        ).jsonObject
        prepared.requireSuccess("Failed to prepare upload")
        val uploadKey = prepared.string("uploadKey") ?: throw TeakException(null, "Failed to prepare upload")
        val uploadUrl = prepared.string("uploadUrl") ?: throw TeakException(null, "Failed to prepare upload")
        onProgress(0.05f)

        val etag = put(uploadUrl, File(file.path), file.mimeType) { sent -> onProgress(0.05f + 0.9f * sent) }

        val finalized = convex.action(
            "cards:finalizeUploadedCard",
            buildMap {
                put("fileKey", uploadKey)
                put("fileName", file.fileName)
                put("fileSize", file.size.toDouble())
                put("fileType", file.mimeType)
                etag?.let { put("fileEtag", it) }
                metadata?.let { put("additionalMetadata", it) }
            },
        ).jsonObject
        finalized.requireSuccess("Failed to create card")
        onProgress(1f)
        return finalized.string("cardId") ?: throw TeakException(null, "Failed to create card")
    }

    /** PUTs the raw bytes, retrying twice on timeouts, rate limits, server errors and dropped connections. */
    private suspend fun put(url: String, file: File, mimeType: String, onProgress: (Float) -> Unit): String? =
        withContext(Dispatchers.IO) {
            var attempt = 0
            while (true) {
                attempt += 1
                val request = Request.Builder()
                    .url(url)
                    .header("Content-Type", mimeType)
                    .put(ProgressBody(file, mimeType.toMediaTypeOrNull(), onProgress))
                    .build()
                try {
                    httpClient.newCall(request).execute().use { response ->
                        if (response.isSuccessful) return@withContext response.header("ETag")
                        if (attempt >= MAX_ATTEMPTS || response.code !in RETRYABLE) {
                            throw TeakException(null, "Upload failed with status ${response.code}")
                        }
                    }
                } catch (e: IOException) {
                    if (attempt >= MAX_ATTEMPTS) throw TeakException(TeakException.OFFLINE, "Check your connection and try again.", e)
                }
                delay(RETRY_DELAYS_MS[attempt - 1])
            }
            @Suppress("UNREACHABLE_CODE")
            null
        }

    private fun JsonObject.requireSuccess(fallback: String) {
        if (get("success")?.jsonPrimitive?.booleanOrNull != true) {
            throw TeakException(string("errorCode"), string("error") ?: fallback)
        }
    }

    private class ProgressBody(
        private val file: File,
        private val type: MediaType?,
        private val onProgress: (Float) -> Unit,
    ) : RequestBody() {
        override fun contentType() = type
        override fun contentLength() = file.length()
        override fun writeTo(sink: BufferedSink) {
            val total = file.length().coerceAtLeast(1)
            var sent = 0L
            file.source().use { source ->
                while (true) {
                    val read = source.read(sink.buffer, CHUNK)
                    if (read == -1L) break
                    sink.flush()
                    sent += read
                    onProgress(sent.toFloat() / total)
                }
            }
        }
    }

    private companion object {
        const val MAX_ATTEMPTS = 3
        const val CHUNK = 64 * 1024L
        val RETRY_DELAYS_MS = listOf(300L, 900L)
        val RETRYABLE = setOf(408, 429) + (500..599)
    }
}
