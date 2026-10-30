package com.praveenjuge.teak.core.data.offline

import android.content.Context
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.model.Card
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Cards kept for offline use: the card as the server last sent it, and its file. They live outside the cache,
 * so Android doesn't clear them, and leave with the account whenever its session ends.
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
    sessions: SessionManager,
    @ApplicationScope scope: CoroutineScope,
) : OfflineCopies {
    // Under files/, which backup_rules.xml and data_extraction_rules.xml keep off backups, so a PDF here can still
    // be shared through the FileProvider.
    private val root = File(context.filesDir, DIRECTORY)

    /** Keeps the startup scan, keeping, removing and clearing from overlapping. */
    private val mutex = Mutex()

    private val _kept = MutableStateFlow<Set<String>>(emptySet())
    override val kept: StateFlow<Set<String>> = _kept.asStateFlow()

    init {
        scope.launch(Dispatchers.IO) {
            mutex.withLock {
                _kept.value += root.listFiles().orEmpty().filter { File(it, CARD_FILE).exists() }.map { it.name }
            }
        }
        // Signing out isn't the only way a session ends (a refresh token can be refused), so follow the session.
        scope.launch {
            sessions.state.collect { state ->
                when (state) {
                    SessionState.SignedOut -> clear()
                    is SessionState.SignedIn -> claim(state.user.id)
                    SessionState.Loading -> Unit
                }
            }
        }
    }

    /** Copies another account kept never show in this one: they go when a different account signs in. */
    private suspend fun claim(userId: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val owner = File(root, OWNER_FILE)
            val keptBy = owner.takeIf { it.exists() }?.readText()
            if (keptBy == userId) return@withLock
            if (keptBy != null) {
                root.deleteRecursively()
                _kept.value = emptySet()
            }
            root.mkdirs()
            owner.writeText(userId)
        }
    }

    override suspend fun keep(card: Card) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val directory = directory(card.id)
            directory.deleteRecursively()
            directory.mkdirs()
            try {
                card.fileUrl?.let { url -> download(url, File(directory, DATA_FILE)) }
                writeCard(directory, card)
            } catch (e: IOException) {
                directory.deleteRecursively()
                throw e
            }
            _kept.value += card.id
        }
    }

    override suspend fun remove(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            directory(id).deleteRecursively()
            _kept.value -= id
        }
    }

    override suspend fun card(id: String): Card? = withContext(Dispatchers.IO) { read(directory(id)) }

    override suspend fun update(card: Card) {
        if (card.id !in _kept.value) return
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val directory = directory(card.id)
                val saved = read(directory) ?: return@withLock
                // A new file on the server makes the kept one stale: show the server's until it's kept again.
                if (saved.fileUrl?.withoutQuery() != card.fileUrl?.withoutQuery()) File(directory, DATA_FILE).delete()
                writeCard(directory, card)
            }
        }
    }

    override fun file(id: String): File? =
        File(directory(id), DATA_FILE).takeIf { id in _kept.value && it.length() > 0 }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock {
            root.deleteRecursively()
            _kept.value = emptySet()
        }
    }

    private fun directory(id: String) = File(root, id.replace(unsafeNameCharacters, "_"))

    private fun read(directory: File): Card? {
        val saved = File(directory, CARD_FILE)
        if (!saved.exists()) return null
        return runCatching { teakJson.decodeFromString(Card.serializer(), saved.readText()) }.getOrNull()
    }

    /** Written to a copy first, so a crash mid-write leaves the old card whole. */
    private fun writeCard(directory: File, card: Card) {
        val partial = File(directory, "$CARD_FILE.part")
        partial.writeText(teakJson.encodeToString(Card.serializer(), card))
        if (!partial.renameTo(File(directory, CARD_FILE))) throw IOException("Couldn't keep the card")
    }

    private fun download(url: String, target: File) {
        val partial = File(target.parentFile, "${target.name}.part")
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            val body = response.body ?: throw IOException("Empty response")
            partial.outputStream().use { output -> body.byteStream().copyTo(output) }
        }
        if (!partial.renameTo(target)) throw IOException("Couldn't keep the file")
    }

    /** A signed file link without its signature, which changes every few hours for the same file. */
    private fun String.withoutQuery(): String = substringBefore('?')

    private companion object {
        const val DIRECTORY = "offline"
        const val CARD_FILE = "card.json"
        const val DATA_FILE = "file"
        const val OWNER_FILE = "owner"
        val unsafeNameCharacters = Regex("[^A-Za-z0-9_-]")
    }
}
