package com.praveenjuge.teak.core.data

import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.PendingSignIn
import com.praveenjuge.teak.core.data.auth.SessionStore
import com.praveenjuge.teak.core.data.auth.SessionUser
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.offline.OfflineCopies
import com.praveenjuge.teak.core.data.offline.Outbox
import com.praveenjuge.teak.core.data.offline.OutboxItem
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardFieldChange
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import java.io.File
import java.util.Base64

class FakeConvexApi : ConvexApi {
    data class Call(val name: String, val args: Map<String, Any?>)

    val calls = mutableListOf<Call>()
    val responses = mutableMapOf<String, (Map<String, Any?>) -> JsonElement>()

    /** Mutations and actions fail as the live client's do offline. */
    var offline = false

    override fun subscribe(name: String, args: Map<String, Any?>): Flow<Result<JsonElement>> {
        calls += Call(name, args)
        return flowOf(Result.success(responses[name]?.invoke(args) ?: JsonNull))
    }

    override suspend fun mutation(name: String, args: Map<String, Any?>): JsonElement = call(name, args)

    override suspend fun action(name: String, args: Map<String, Any?>): JsonElement = call(name, args)

    override val isConnected: Flow<Boolean> = MutableStateFlow(true)

    override val connectedNow: Boolean get() = !offline

    private fun call(name: String, args: Map<String, Any?>): JsonElement {
        if (offline) throw com.praveenjuge.teak.core.data.convex.offlineException()
        calls += Call(name, args)
        return responses[name]?.invoke(args) ?: JsonNull
    }
}

class InMemorySessionStore : SessionStore {
    var session: AuthSession? = null
    var pending: PendingSignIn? = null
    override suspend fun loadSession() = session
    override suspend fun saveSession(session: AuthSession) {
        this.session = session
    }
    override suspend fun clearSession() {
        // The real store suspends here (it moves to the IO dispatcher), so a cancelled caller stops before clearing.
        yield()
        session = null
    }
    override suspend fun loadPending() = pending
    override suspend fun savePending(pending: PendingSignIn) {
        this.pending = pending
    }
    override suspend fun clearPending() {
        pending = null
    }
}

object Tokens {
    private val encoder = Base64.getUrlEncoder().withoutPadding()

    fun jwt(clientId: String, sub: String, sid: String, exp: Long): String {
        val header = encoder.encodeToString("""{"alg":"none"}""".toByteArray())
        val payload = encoder.encodeToString(
            """{"iss":"https://api.workos.com/user_management/$clientId","sub":"$sub","sid":"$sid","exp":$exp}""".toByteArray(),
        )
        return "$header.$payload.sig"
    }

    fun session(
        clientId: String = "client_1",
        userId: String = "user_1",
        sid: String = "session_1",
        expiresAtMillis: Long,
        refreshToken: String = "refresh_1",
        teakUserId: String? = "teak_1",
    ) = AuthSession(
        clientId = clientId,
        accessToken = jwt(clientId, userId, sid, expiresAtMillis / 1000),
        refreshToken = refreshToken,
        expiresAtMillis = expiresAtMillis,
        sessionId = sid,
        user = SessionUser(userId, "ada@example.com", true, "Ada", teakUserId),
    )
}

class FakeOutbox : Outbox {
    override val items = MutableStateFlow<List<OutboxItem>>(emptyList())
    override val pendingEdits = MutableStateFlow<Map<String, List<CardFieldChange>>>(emptyMap())

    override suspend fun add(items: List<OutboxItem>) = set(this.items.value + items)

    override suspend fun next(): OutboxItem? = items.value.firstOrNull()

    override suspend fun remove(id: String) = set(items.value.filterNot { it.id == id })

    override suspend fun clear() = set(emptyList())

    private fun set(next: List<OutboxItem>) {
        items.value = next
        pendingEdits.value = next.filterIsInstance<OutboxItem.Edit>().groupBy({ it.cardId }, { it.change })
    }
}

class FakeOfflineCopies : OfflineCopies {
    val cards = mutableMapOf<String, Card>()
    override val kept = MutableStateFlow<Set<String>>(emptySet())

    override suspend fun keep(card: Card) {
        cards[card.id] = card
        kept.value += card.id
    }

    override suspend fun remove(id: String) {
        cards -= id
        kept.value -= id
    }

    override suspend fun card(id: String): Card? = cards[id]

    override suspend fun update(card: Card) {
        if (card.id in cards) cards[card.id] = card
    }

    override fun file(id: String): File? = null

    override suspend fun clear() {
        cards.clear()
        kept.value = emptySet()
    }
}
