package com.praveenjuge.teak.core.data.offline

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.await
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.model.CardFieldChange
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A write made while offline, waiting to be sent. [ownerId] is the signed-in account's user id when it was made,
 * so it's only ever sent into that account.
 */
@Serializable
sealed interface OutboxItem {
    val id: String
    val ownerId: String?

    fun withOwner(ownerId: String?): OutboxItem

    @Serializable @SerialName("edit")
    data class Edit(
        override val id: String,
        val cardId: String,
        val change: CardFieldChange,
        override val ownerId: String? = null,
    ) : OutboxItem {
        override fun withOwner(ownerId: String?) = copy(ownerId = ownerId)
    }

    /** A note or link saved from text, sent as `cards:createCard` once there's a connection. */
    @Serializable @SerialName("createText")
    data class CreateText(override val id: String, val text: String, override val ownerId: String? = null) : OutboxItem {
        override fun withOwner(ownerId: String?) = copy(ownerId = ownerId)
    }

    companion object {
        fun newId(): String = UUID.randomUUID().toString()
    }
}

/**
 * Writes made offline, kept in order in a file outside the cache (and out of backups) until [OutboxWorker] sends
 * them. Edits still waiting show on top of what the server sends ([pendingEdits]), so the app shows them at once.
 */
interface Outbox {
    val items: StateFlow<List<OutboxItem>>

    /** Each card's edits that are still waiting, oldest first. */
    val pendingEdits: StateFlow<Map<String, List<CardFieldChange>>>

    suspend fun add(items: List<OutboxItem>)

    /** The oldest waiting write, once the saved ones are read. */
    suspend fun next(): OutboxItem?

    suspend fun remove(id: String)

    /** Drops every waiting write. */
    suspend fun clear()
}

@Singleton
class FileOutbox @Inject constructor(
    @ApplicationContext private val context: Context,
    convex: ConvexApi,
    private val sessions: SessionManager,
    @ApplicationScope scope: CoroutineScope,
) : Outbox {
    private val file = File(context.noBackupFilesDir, FILE_NAME)
    private val mutex = Mutex()
    private val loaded = CompletableDeferred<Unit>()
    private val serializer = ListSerializer(OutboxItem.serializer())

    private val _items = MutableStateFlow<List<OutboxItem>>(emptyList())
    override val items: StateFlow<List<OutboxItem>> = _items.asStateFlow()

    private val _pendingEdits = MutableStateFlow<Map<String, List<CardFieldChange>>>(emptyMap())
    override val pendingEdits: StateFlow<Map<String, List<CardFieldChange>>> = _pendingEdits.asStateFlow()

    init {
        scope.launch {
            mutex.withLock {
                publish(withContext(Dispatchers.IO) { read() })
                loaded.complete(Unit)
            }
        }
        // A session can end without signing out (a refresh token the server refused). Writes made in it stay for
        // that account, and go as soon as someone else signs in, so none reaches the wrong vault.
        scope.launch {
            sessions.state.filterIsInstance<SessionState.SignedIn>().collect { signedIn ->
                loaded.await()
                if (_items.value.any { it.ownerId != signedIn.user.id }) update { items -> items.filter { it.ownerId == signedIn.user.id } }
            }
        }
        // WorkManager waits for the device's network; Teak's own connection can come back later, so a reconnect
        // sends what's waiting too.
        scope.launch {
            combine(convex.isConnected.distinctUntilChanged(), _items) { connected, items -> connected && items.isNotEmpty() }
                .distinctUntilChanged()
                .filter { it }
                .collect { OutboxWorker.schedule(context) }
        }
    }

    override suspend fun add(items: List<OutboxItem>) {
        if (items.isEmpty()) return
        val owner = (sessions.state.value as? SessionState.SignedIn)?.user?.id
        update { it + items.map { item -> item.withOwner(owner) } }
        OutboxWorker.schedule(context)
    }

    override suspend fun next(): OutboxItem? {
        loaded.await()
        return _items.value.firstOrNull()
    }

    override suspend fun remove(id: String) = update { items -> items.filterNot { it.id == id } }

    override suspend fun clear() {
        WorkManager.getInstance(context).cancelUniqueWork(OutboxWorker.QUEUE).await()
        update { emptyList() }
    }

    private suspend fun update(transform: (List<OutboxItem>) -> List<OutboxItem>) {
        loaded.await()
        mutex.withLock {
            val next = transform(_items.value)
            withContext(Dispatchers.IO) { write(next) }
            publish(next)
        }
    }

    private fun publish(items: List<OutboxItem>) {
        _items.value = items
        _pendingEdits.value = items.filterIsInstance<OutboxItem.Edit>().groupBy({ it.cardId }, { it.change })
    }

    private fun read(): List<OutboxItem> =
        if (!file.exists()) {
            emptyList()
        } else {
            runCatching { teakJson.decodeFromString(serializer, file.readText()) }
                .onFailure { Log.w(TAG, "Couldn't read the outbox; starting it empty", it) }
                .getOrDefault(emptyList())
        }

    /** Written to a copy first, so a crash mid-write leaves the old file whole. */
    private fun write(items: List<OutboxItem>) {
        if (items.isEmpty()) {
            file.delete()
            return
        }
        val partial = File(file.parentFile, "$FILE_NAME.part")
        partial.writeText(teakJson.encodeToString(serializer, items))
        if (!partial.renameTo(file)) throw java.io.IOException("Couldn't save the outbox")
    }

    private companion object {
        const val FILE_NAME = "outbox.json"
        const val TAG = "TeakOutbox"
    }
}

internal fun OutboxWorker.Companion.request() =
    OneTimeWorkRequestBuilder<OutboxWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
        .build()

internal fun OutboxWorker.Companion.schedule(context: Context) {
    // A worker that's already sending loops until the outbox is empty; the appended one finds it empty and ends.
    WorkManager.getInstance(context).enqueueUniqueWork(QUEUE, ExistingWorkPolicy.APPEND_OR_REPLACE, request())
}
