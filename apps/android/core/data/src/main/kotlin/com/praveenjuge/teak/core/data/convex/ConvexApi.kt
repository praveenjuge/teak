package com.praveenjuge.teak.core.data.convex

import dev.convex.android.ConvexClient
import dev.convex.android.ConvexError
import dev.convex.android.ServerError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException

/**
 * The Convex functions Teak calls, by name. Arguments are plain maps; every number must be a
 * [Double], because the backend's `v.number()` rejects the int64 the SDK sends for Int and Long.
 */
interface ConvexApi {
    fun subscribe(name: String, args: Map<String, Any?> = emptyMap()): Flow<Result<JsonElement>>
    suspend fun mutation(name: String, args: Map<String, Any?> = emptyMap()): JsonElement
    suspend fun action(name: String, args: Map<String, Any?> = emptyMap()): JsonElement
    val isConnected: Flow<Boolean>
}

class LiveConvexApi(private val client: ConvexClient) : ConvexApi {
    override fun subscribe(name: String, args: Map<String, Any?>): Flow<Result<JsonElement>> =
        client.subscribe<JsonElement>(name, args).map { result -> result.recoverCatching { throw it.toTeakException() } }

    override suspend fun mutation(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { client.mutation<JsonElement>(name, args) }

    override suspend fun action(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { client.action<JsonElement>(name, args) }

    override val isConnected: Flow<Boolean> =
        client.webSocketStateFlow.map { it == dev.convex.android.WebSocketState.CONNECTED }

    private inline fun convexCall(block: () -> JsonElement): JsonElement =
        try {
            block()
        } catch (e: ConvexError) {
            throw e.toTeakException()
        } catch (e: ServerError) {
            throw e.toTeakException()
        } catch (e: IOException) {
            throw e.toTeakException()
        }
}

/** A backend failure with the code and message the server sent, when it sent one. */
class TeakException(val code: String?, message: String, cause: Throwable? = null) : Exception(message, cause) {
    companion object {
        const val CARD_LIMIT_REACHED = "CARD_LIMIT_REACHED"
        const val FILE_TOO_LARGE = "FILE_TOO_LARGE"
        const val RATE_LIMITED = "RATE_LIMITED"
        const val UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE"
        const val OFFLINE = "OFFLINE"
    }
}

internal val teakJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** Maps SDK errors to [TeakException], keeping the server's code and message for `ConvexError`s. */
fun Throwable.toTeakException(): Throwable = when (this) {
    is TeakException -> this
    is ConvexError -> {
        val data = runCatching { teakJson.parseToJsonElement(data) }.getOrNull()
        val obj = data as? JsonObject
        val code = obj?.get("code")?.jsonPrimitive?.contentOrNull
        val message = obj?.get("message")?.jsonPrimitive?.contentOrNull
            ?: (data?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() })
            ?: "Something went wrong. Please try again."
        TeakException(code, message, this)
    }
    is ServerError -> TeakException(null, "Something went wrong. Please try again.", this)
    is IOException -> TeakException(TeakException.OFFLINE, "Check your connection and try again.", this)
    else -> this
}

internal fun JsonElement.objectOrNull(): JsonObject? = this as? JsonObject

internal fun JsonObject.string(key: String): String? =
    (get(key) as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull

internal fun JsonElement.asObject(): JsonObject = jsonObject

