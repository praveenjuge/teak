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

interface ConvexApi {
    fun subscribe(name: String, args: Map<String, Any?> = emptyMap()): Flow<Result<JsonElement>>
    suspend fun mutation(name: String, args: Map<String, Any?> = emptyMap()): JsonElement
    suspend fun action(name: String, args: Map<String, Any?> = emptyMap()): JsonElement
    val isConnected: Flow<Boolean>
}

class LiveConvexApi(private val client: ConvexClient) : ConvexApi {
    override fun subscribe(name: String, args: Map<String, Any?>): Flow<Result<JsonElement>> =
        client.subscribe<JsonElement>(name, args.withNumbersAsDoubles())
            .map { result -> result.recoverCatching { throw it.toTeakException() } }

    override suspend fun mutation(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { client.mutation<JsonElement>(name, args.withNumbersAsDoubles()) }

    override suspend fun action(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { client.action<JsonElement>(name, args.withNumbersAsDoubles()) }

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

/** The SDK sends Int and Long as int64, which the backend's `v.number()` rejects, so every number goes as a Double. */
internal fun Map<String, Any?>.withNumbersAsDoubles(): Map<String, Any?> = mapValues { (_, value) -> value.numbersAsDoubles() }

private fun Any?.numbersAsDoubles(): Any? = when (this) {
    is Double -> this
    is Number -> toDouble()
    is Map<*, *> -> entries.associate { (key, value) -> key to value.numbersAsDoubles() }
    is List<*> -> map { it.numbersAsDoubles() }
    else -> this
}

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

