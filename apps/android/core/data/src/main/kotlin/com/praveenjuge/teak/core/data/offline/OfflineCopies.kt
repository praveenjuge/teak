package com.praveenjuge.teak.core.data.offline

import android.content.Context
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.CardType
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Cards kept for offline use: the card as the server last sent it, and its file. They live outside the cache,
 * so Android doesn't clear them, and leave with the account whenever its session ends.
 */
interface OfflineCopies {
    /** Ids of the cards kept offline. */
    val kept: StateFlow<Set<String>>

    /** Goes up whenever a kept card or its file changes, for screens showing [file]. */
    val changes: StateFlow<Long>

    /** Saves [card] and downloads its file (an image's shown rendition). Throws when it can't be downloaded, keeping nothing. */
    suspend fun keep(card: Card)

    suspend fun remove(id: String)

    /** The kept card, or null when it isn't kept. */
    suspend fun card(id: String): Card?

    /** Saves a newer copy of a kept card; does nothing for one that isn't kept. */
    suspend fun update(card: Card)

    /** Changes the saved copy of a kept card in place, so nothing written meanwhile is lost. */
    suspend fun edit(id: String, change: (Card) -> Card)

    /** The kept card's file, or null when it isn't kept or has none. */
    fun file(id: String): File?

    suspend fun clear()
}

@Singleton
class DiskOfflineCopies @Inject constructor(
    @ApplicationContext context: Context,
    private val client: OkHttpClient,
    private val sessions: SessionManager,
    @ApplicationScope private val scope: CoroutineScope,
) : OfflineCopies {
    // Under files/, which backup_rules.xml and data_extraction_rules.xml keep off backups, so a PDF here can still
    // be shared through the FileProvider.
    private val root = File(context.filesDir, DIRECTORY)

    /** Keeps the startup scan, keeping, removing and clearing from overlapping. */
    private val mutex = Mutex()

    /** Goes up each time the copies are cleared, so a download that started before doesn't land after. */
    @Volatile private var clears = 0

    /** The account the copies on disk were checked to belong to; nothing is read or kept until it's the signed-in one. */
    private val claimedBy = MutableStateFlow<String?>(null)

    private val _kept = MutableStateFlow<Set<String>>(emptySet())
    override val kept: StateFlow<Set<String>> = _kept.asStateFlow()

    private val _changes = MutableStateFlow(0L)
    override val changes: StateFlow<Long> = _changes.asStateFlow()

    init {
        val startedAt = System.currentTimeMillis()
        scope.launch(Dispatchers.IO) {
            mutex.withLock {
                // A staging folder an earlier run died with is never a kept card; one this run made is a download.
                root.listFiles().orEmpty()
                    .filter { it.name.startsWith(STAGING_PREFIX) && it.lastModified() < startedAt }
                    .forEach { it.deleteRecursively() }
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
            if (keptBy != null && keptBy != userId) {
                root.deleteRecursively()
                clears += 1
            }
            root.mkdirs()
            owner.writeText(userId)
            // Only now are the cards on disk known to be this account's.
            _kept.value = root.listFiles().orEmpty().filter { File(it, CARD_FILE).exists() }.map { it.name }.toSet()
            claimedBy.value = userId
            _changes.value += 1
        }
    }

    /** The copies on disk were claimed by the account signed in now. */
    private fun owned(): Boolean = owned(sessions.state.value, claimedBy.value)

    private fun owned(session: SessionState, claimed: String?): Boolean {
        val user = (session as? SessionState.SignedIn)?.user?.id
        return user != null && user == claimed
    }

    /**
     * Downloads into a staging folder without the lock, so a large file never holds up signing out, then moves it
     * into place. One the account was cleared during is thrown away.
     */
    override suspend fun keep(card: Card) = withContext(Dispatchers.IO) {
        if (!owned()) throw IOException("The signed-in account hasn't claimed its offline copies yet")
        val started = clears
        val staging = File(root, STAGING_PREFIX + UUID.randomUUID()).apply { mkdirs() }
        try {
            keptSource(card)?.let { url -> download(url, File(staging, DATA_FILE)) }
            writeSource(staging, keptSource(card))
            writeCard(staging, card)
            mutex.withLock {
                if (clears != started) throw IOException("The account's copies were cleared while keeping the card")
                val directory = directory(card.id)
                directory.deleteRecursively()
                if (!staging.renameTo(directory)) throw IOException("Couldn't keep the card")
                _kept.value += card.id
                _changes.value += 1
            }
        } finally {
            staging.deleteRecursively()
        }
    }

    override suspend fun remove(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            directory(id).deleteRecursively()
            _kept.value -= id
            _changes.value += 1
        }
    }

    /** A card opened just after launch waits briefly for the account to claim its copies, so it still shows offline. */
    override suspend fun card(id: String): Card? = withContext(Dispatchers.IO) {
        val claimed = owned() || withTimeoutOrNull(CLAIM_WAIT_MS) {
            combine(sessions.state, claimedBy, ::owned).first { it }
        } != null
        if (claimed) read(directory(id)) else null
    }

    /**
     * Saves a newer copy. When its file changed on the server, or an image gained the rendition it shows, the new one
     * downloads in the background and replaces the kept file once it's in; until then the old file stays, so the card
     * still opens offline.
     */
    override suspend fun update(card: Card) {
        if (!owned() || card.id !in _kept.value) return
        val start = withContext(Dispatchers.IO) {
            mutex.withLock {
                val directory = directory(card.id)
                if (read(directory) == null) return@withLock false
                writeCard(directory, card)
                // Against the link the kept file came from, not the card just saved, so a replacement that failed is
                // tried again on the next update. One already downloading picks up this change when it finishes.
                downloadedSource(directory) != keptSource(card)?.withoutQuery() && replacing.add(card.id)
            }
        }
        if (start) scope.launch(Dispatchers.IO) { replaceUntilCurrent(card.id) }
    }

    /** Cards whose new file is downloading. Only changed under [mutex], with the decision to start or stop. */
    private val replacing = mutableSetOf<String>()

    /**
     * Downloads the saved card's file until the kept file matches it, so a change that arrives mid-download is
     * fetched too. Stops when a download fails (the next update tries again) or the card is no longer kept.
     */
    private suspend fun replaceUntilCurrent(id: String) {
        var released = false
        try {
            var wanted = mutex.withLock { currentSource(id).also { if (it == null) released = replacing.remove(id) } }
            while (wanted != null) {
                val replaced = replaceFile(id, wanted.link)
                wanted = mutex.withLock {
                    val next = currentSource(id)?.takeIf { replaced && downloadedSource(directory(id)) != it.link?.withoutQuery() }
                    if (next == null) released = replacing.remove(id)
                    next
                }
            }
        } catch (_: IOException) {
            // Reading the kept card failed: the next update tries again.
        } finally {
            // Whatever stopped it, the card mustn't stay marked as downloading, or no update would start one again.
            if (!released) withContext(NonCancellable) { mutex.withLock { replacing.remove(id) } }
        }
    }

    /** The kept card's current source, boxed so a card with no file (a null link) still counts as kept. */
    private class Source(val link: String?)

    private fun currentSource(id: String): Source? =
        if (id in _kept.value) read(directory(id))?.let { Source(keptSource(it)) } else null

    /** False when the download failed; true when the file was replaced or a newer source made it moot. */
    private suspend fun replaceFile(id: String, source: String?): Boolean {
        val started = clears
        val staging = File(root, STAGING_PREFIX + UUID.randomUUID()).apply { mkdirs() }
        return try {
            val downloaded = source?.let { File(staging, DATA_FILE).also { file -> download(it, file) } }
            mutex.withLock {
                val directory = directory(id)
                // Cleared, no longer kept, or changed again: the caller looks at the card again.
                if (clears != started || id !in _kept.value || read(directory)?.let(::keptSource)?.withoutQuery() != source?.withoutQuery()) {
                    return@withLock clears == started
                }
                val target = File(directory, DATA_FILE)
                if (downloaded == null) target.delete() else if (!downloaded.renameTo(target)) return@withLock false
                writeSource(directory, source)
                _changes.value += 1
                true
            }
        } catch (_: IOException) {
            // Offline or a failed download: the old file stays, and the next update tries again.
            false
        } catch (_: IllegalArgumentException) {
            // A link OkHttp can't read.
            false
        } finally {
            staging.deleteRecursively()
        }
    }

    override suspend fun edit(id: String, change: (Card) -> Card) {
        if (!owned() || id !in _kept.value) return
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val directory = directory(id)
                read(directory)?.let { writeCard(directory, change(it)) }
            }
        }
    }

    override fun file(id: String): File? =
        File(directory(id), DATA_FILE).takeIf { owned() && id in _kept.value && it.length() > 0 }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock {
            root.deleteRecursively()
            _kept.value = emptySet()
            clears += 1
            claimedBy.value = null
            _changes.value += 1
        }
    }

    private fun directory(id: String) = File(root, id.replace(unsafeNameCharacters, "_"))

    private fun read(directory: File): Card? {
        val saved = File(directory, CARD_FILE)
        if (!saved.exists()) return null
        return runCatching { teakJson.decodeFromString(Card.serializer(), saved.readText()) }.getOrNull()
    }

    /** The link (without its signature) the kept file was downloaded from, or null when there's no file. */
    private fun downloadedSource(directory: File): String? {
        val saved = File(directory, SOURCE_FILE)
        return if (saved.exists()) saved.readText().ifEmpty { null } else read(directory)?.let(::keptSource)?.withoutQuery()
    }

    private fun writeSource(directory: File, source: String?) {
        File(directory, SOURCE_FILE).writeText(source?.withoutQuery().orEmpty())
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

    /**
     * What's downloaded for a card: an image keeps the rendition its preview shows, since the app can't decode some
     * originals (SVG, HEIC); every other card keeps its file.
     */
    private fun keptSource(card: Card): String? =
        if (card.type == CardType.Image) CardSheet.imagePrimaryUrl(card) else card.fileUrl

    /** A signed file link without its signature, which changes every few hours for the same file. */
    private fun String.withoutQuery(): String = substringBefore('?')

    private companion object {
        const val DIRECTORY = "offline"
        const val CARD_FILE = "card.json"
        const val DATA_FILE = "file"
        const val SOURCE_FILE = "source"
        const val OWNER_FILE = "owner"
        const val STAGING_PREFIX = ".keeping-"
        const val CLAIM_WAIT_MS = 3_000L
        val unsafeNameCharacters = Regex("[^A-Za-z0-9_-]")
    }
}
