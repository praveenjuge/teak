package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.FOLDER_ERROR_MESSAGES
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD
import com.praveenjuge.teak.core.model.MAX_TAG_NAME_LENGTH
import com.praveenjuge.teak.core.model.UiText
import dev.convex.android.ClientException
import dev.convex.android.ConvexClient
import dev.convex.android.ConvexError
import dev.convex.android.InternalError
import dev.convex.android.ServerError
import dev.convex.android.WebSocketState
import dev.convex.android.toError
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withTimeoutOrNull
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

    /** Whether the socket is up at this moment. */
    val connectedNow: Boolean
}

class LiveConvexApi(private val client: ConvexClient) : ConvexApi {
    // The SDK starts a subscription without catching the native client's errors, so one (such as
    // "channel closed" once its connection has shut down) would crash whoever collects. It arrives
    // as a failed result instead, like the errors the SDK does report.
    override fun subscribe(name: String, args: Map<String, Any?>): Flow<Result<JsonElement>> =
        client.subscribe<JsonElement>(name, args.withNumbersAsDoubles())
            .catch { error -> if (error is ClientException) emit(Result.failure(error.toError())) else throw error }
            .map { result -> result.recoverCatching { throw it.toTeakException() } }

    override suspend fun mutation(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { whileConnected { client.mutation<JsonElement>(name, args.withNumbersAsDoubles()) } }

    override suspend fun action(name: String, args: Map<String, Any?>): JsonElement =
        convexCall { whileConnected { client.action<JsonElement>(name, args.withNumbersAsDoubles()) } }

    override val isConnected: Flow<Boolean> =
        client.webSocketStateFlow.map { it == WebSocketState.CONNECTED }

    override val connectedNow: Boolean get() = client.webSocketStateFlow.value == WebSocketState.CONNECTED

    /**
     * Runs [call] only while the socket is up. The native client holds a call made offline, or one whose
     * connection drops, until a reconnect that may never resend it, so such a call fails as [TeakException.OFFLINE]
     * instead: the caller can keep the write for later or say it's offline. A socket that's still connecting gets
     * [CONNECT_GRACE_MS] first, as when the app has just opened.
     */
    private suspend fun whileConnected(call: suspend () -> JsonElement): JsonElement {
        val state = client.webSocketStateFlow
        withTimeoutOrNull(CONNECT_GRACE_MS) { state.first { it == WebSocketState.CONNECTED } } ?: throw offlineException()
        return coroutineScope {
            val result = async { call() }
            val dropped = async { state.first { it != WebSocketState.CONNECTED } }
            select {
                result.onAwait { value -> dropped.cancel(); value }
                dropped.onAwait { result.cancel(); throw offlineException() }
            }
        }
    }

    private companion object {
        const val CONNECT_GRACE_MS = 3_000L
    }

    private inline fun convexCall(block: () -> JsonElement): JsonElement =
        try {
            block()
        } catch (e: ConvexError) {
            throw e.toTeakException()
        } catch (e: ServerError) {
            throw e.toTeakException()
        } catch (e: InternalError) {
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

/**
 * A failure to show a person. [message] stays English for logs; [text] is what to show: the catalog's
 * words for a known [code], else the server's message as it is.
 */
class TeakException(
    val code: String?,
    message: String,
    cause: Throwable? = null,
    val text: UiText = code?.let(::textFor) ?: textForFolderMessage(message) ?: UiText.verbatim(message),
) : Exception(message, cause) {
    companion object {
        const val CARD_LIMIT_REACHED = "CARD_LIMIT_REACHED"
        const val FILE_TOO_LARGE = "FILE_TOO_LARGE"
        const val RATE_LIMITED = "RATE_LIMITED"
        const val UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE"
        const val OFFLINE = "OFFLINE"

        /**
         * The web's text for a code the backend throws (`errors.<group>.<CODE>`), as Apple's
         * `TeakError.localizedMessage` maps them. Codes more than one group throws with different words
         * (`NOT_FOUND`, `RATE_LIMITED`, `EMPTY_NAME`, `NAME_TOO_LONG`), and ones whose limit the app
         * doesn't know, keep the server's message.
         */
        fun textFor(code: String): UiText? = when (code) {
            OFFLINE -> UiText.of("native.errors.offline")
            CARD_LIMIT_REACHED -> UiText.of("errors.cards.CARD_LIMIT_REACHED")
            "CONTENT_TOO_LARGE" -> UiText.of("errors.cards.CONTENT_TOO_LARGE")
            "INVALID_UTF8" -> UiText.of("errors.cards.INVALID_UTF8")
            FILE_TOO_LARGE -> UiText.of("errors.cards.FILE_TOO_LARGE")
            "TOO_MANY_FILES" -> UiText.of("errors.cards.TOO_MANY_FILES", MAX_FILES_PER_UPLOAD.toString())
            UNSUPPORTED_TYPE -> UiText.of("errors.cards.UNSUPPORTED_TYPE")
            "TYPE_MISMATCH" -> UiText.of("errors.cards.TYPE_MISMATCH")
            "DUPLICATE_NAME" -> UiText.of("errors.folders.DUPLICATE_NAME")
            "EMPTY_QUERY" -> UiText.of("errors.folders.EMPTY_QUERY")
            "SMART_FOLDER_IN_QUERY" -> UiText.of("errors.folders.SMART_FOLDER_IN_QUERY")
            "SMART_FOLDER_MEMBERSHIP" -> UiText.of("errors.folders.SMART_FOLDER_MEMBERSHIP")
            "QUERY_ON_MANUAL_FOLDER" -> UiText.of("errors.folders.QUERY_ON_MANUAL_FOLDER")
            "SMART_FOLDER_TRASH" -> UiText.of("errors.folders.SMART_FOLDER_TRASH")
            "SAME_TAG" -> UiText.of("errors.tags.SAME_TAG")
            "OPERATION_RUNNING" -> UiText.of("errors.tags.OPERATION_RUNNING")
            "OPERATION_NOT_FOUND" -> UiText.of("errors.tags.OPERATION_NOT_FOUND")
            "TAG_TOO_LONG" -> UiText.of("errors.cardTags.TAG_TOO_LONG", MAX_TAG_NAME_LENGTH.toString())
            "IN_PROGRESS" -> UiText.of("errors.pdfs.IN_PROGRESS")
            "NO_PDF" -> UiText.of("errors.pdfs.NO_PDF")
            "TRASHED" -> UiText.of("errors.pdfs.TRASHED")
            "UNSUPPORTED_LOCALE" -> UiText.of("errors.settings.UNSUPPORTED_LOCALE")
            else -> null
        }

        /**
         * A folder error the server sends in English with a general code (`INVALID_INPUT`, `CONFLICT`), matched by
         * its words as the web's `byEnglishMessage` does. A limit in it, like "at most 500 characters", carries over.
         */
        fun textForFolderMessage(message: String): UiText? {
            val code = FOLDER_ERROR_MESSAGES.entries.firstOrNull { it.value == message }?.key ?: return null
            val limit = Regex("""\d+""").find(message)?.value
            return if (limit != null) UiText.of("errors.folders.$code", limit) else UiText.of("errors.folders.$code")
        }
    }
}

internal val teakJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

private const val GENERIC_FAILURE = "Something went wrong. Please try again."

/** What to show for this failure: a [TeakException]'s text, else [fallback]. */
fun Throwable.teakText(fallback: UiText): UiText = (this as? TeakException)?.text ?: fallback

fun Throwable.toTeakException(): Throwable = when (this) {
    is TeakException -> this
    is ConvexError -> {
        val data = runCatching { teakJson.parseToJsonElement(data) }.getOrNull()
        val obj = data as? JsonObject
        val code = obj?.get("code")?.jsonPrimitive?.contentOrNull
        val message = obj?.get("message")?.jsonPrimitive?.contentOrNull
            ?: (data?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() })
        when {
            message != null -> TeakException(code, message, this)
            else -> TeakException(code, GENERIC_FAILURE, this, code?.let(TeakException::textFor) ?: UiText.of("native.errors.generic"))
        }
    }
    is ServerError, is InternalError -> TeakException(null, GENERIC_FAILURE, this, UiText.of("native.errors.generic"))
    is IOException -> offlineException(this)
    else -> this
}

fun offlineException(cause: Throwable? = null) = TeakException(TeakException.OFFLINE, "Check your connection and try again.", cause)

val Throwable.isOffline: Boolean get() = (this as? TeakException)?.code == TeakException.OFFLINE

/**
 * A write that can go through later unchanged: Teak was offline, the session wasn't signed in to the server yet,
 * or the server asked to slow down. A Convex outage reaches the app as a dropped socket, so it's offline too.
 */
val Throwable.isRetryable: Boolean get() = (this as? TeakException)?.code in RETRYABLE_CODES

private val RETRYABLE_CODES = setOf(TeakException.OFFLINE, TeakException.RATE_LIMITED, "UNAUTHENTICATED")

internal fun JsonElement.objectOrNull(): JsonObject? = this as? JsonObject

internal fun JsonObject.string(key: String): String? =
    (get(key) as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull

internal fun JsonElement.asObject(): JsonObject = jsonObject

