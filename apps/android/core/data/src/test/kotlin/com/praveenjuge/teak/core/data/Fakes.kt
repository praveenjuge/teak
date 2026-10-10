package com.praveenjuge.teak.core.data

import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.PendingSignIn
import com.praveenjuge.teak.core.data.auth.SessionStore
import com.praveenjuge.teak.core.data.auth.SessionUser
import com.praveenjuge.teak.core.data.convex.ConvexApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import java.util.Base64

/** Records every Convex call and answers with canned responses keyed by function name. */
class FakeConvexApi : ConvexApi {
    data class Call(val name: String, val args: Map<String, Any?>)

    val calls = mutableListOf<Call>()
    val responses = mutableMapOf<String, (Map<String, Any?>) -> JsonElement>()

    override fun subscribe(name: String, args: Map<String, Any?>): Flow<Result<JsonElement>> {
        calls += Call(name, args)
        return flowOf(Result.success(responses[name]?.invoke(args) ?: JsonNull))
    }

    override suspend fun mutation(name: String, args: Map<String, Any?>): JsonElement = call(name, args)

    override suspend fun action(name: String, args: Map<String, Any?>): JsonElement = call(name, args)

    override val isConnected: Flow<Boolean> = MutableStateFlow(true)

    private fun call(name: String, args: Map<String, Any?>): JsonElement {
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

    /** An unsigned JWT with the claims the app checks; signatures are Convex's job, not the client's. */
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
