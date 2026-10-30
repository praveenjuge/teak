package com.praveenjuge.teak.core.data.offline

import android.content.Context
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.model.Card
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Cards kept for offline use: the card as the server last sent it, and its file. They live outside the cache,
 * so Android doesn't clear them, and leave with the account on sign-out.
 */
interface OfflineCopies {
    /** Ids of the cards kept offline. */
    val kept: StateFlow<Set<String>>

    /** Saves [card] and downloads its file. Throws when the file can't be downloaded, keeping nothing. */
    suspend fun keep(card: Card)

    suspend fun remove(id: String)

    /** The kept card, or null when it isn't kept. */
    suspend fun card(id: String): Card?

    /** Saves a newer copy of a kept card; does nothing for one that isn't kept. */
    suspend fun update(card: Card)

    /** The kept card's file, or null when it isn't kept or has none. */
    fun file(id: String): File?

    suspend fun clear()
}

@Singleton
class DiskOfflineCopies @Inject constructor(
    @ApplicationContext context: Context,
    private val client: OkHttpClient,
    @ApplicationScope scope: CoroutineScope,
) : OfflineCopies {
    private val root = File(context.filesDir, DIRECTORY)

    private val _kept = MutableStateFlow<Set<String>>(emptySet())
    override val kept: StateFlow<Set<String>> = _kept.asStateFlow()

    init {
        scope.launch(Dispatchers.IO) {
            val ids = root.listFiles().orEmpty().filter { File(it, CARD_FILE).exists() }.map { it.name }.toSet()
            _kept.update { it + ids }
        }
    }

    override suspend fun keep(card: Card) = withContext(Dispatchers.IO) {
        val directory = directory(card.id)
        directory.deleteRecursively()
        directory.mkdirs()
        try {
            card.fileUrl?.let { url -> download(url, File(directory, DATA_FILE)) }
            File(directory, CARD_FILE).writeText(teakJson.encodeToString(Card.serializer(), card))
        } catch (e: IOException) {
            directory.deleteRecursively()
            throw e
        }
        _kept.update { it + card.id }
    }

    override suspend fun remove(id: String) {
        withContext(Dispatchers.IO) { directory(id).deleteRecursively() }
        _kept.update { it - id }
    }

    override suspend fun card(id: String): Card? = withContext(Dispatchers.IO) {
        val saved = File(directory(id), CARD_FILE)
        if (!saved.exists()) return@withContext null
        runCatching { teakJson.decodeFromString(Card.serializer(), saved.readText()) }.getOrNull()
    }

    override suspend fun update(card: Card) {
        if (card.id !in _kept.value) return
        withContext(Dispatchers.IO) {
            val saved = File(directory(card.id), CARD_FILE)
            if (saved.exists()) saved.writeText(teakJson.encodeToString(Card.serializer(), card))
        }
    }

    override fun file(id: String): File? =
        File(directory(id), DATA_FILE).takeIf { id in _kept.value && it.length() > 0 }

    override suspend fun clear() {
        withContext(Dispatchers.IO) { root.deleteRecursively() }
        _kept.value = emptySet()
    }

    private fun directory(id: String) = File(root, id.replace(unsafeNameCharacters, "_"))

    private fun download(url: String, target: File) {
        val partial = File(target.parentFile, "${target.name}.part")
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            val body = response.body ?: throw IOException("Empty response")
            partial.outputStream().use { output -> body.byteStream().copyTo(output) }
        }
        if (!partial.renameTo(target)) throw IOException("Couldn't keep the file")
    }

    private companion object {
        const val DIRECTORY = "offline"
        const val CARD_FILE = "card.json"
        const val DATA_FILE = "file"
        val unsafeNameCharacters = Regex("[^A-Za-z0-9_-]")
    }
}
