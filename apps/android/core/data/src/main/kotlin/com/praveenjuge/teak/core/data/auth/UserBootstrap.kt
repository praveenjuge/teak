package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.model.TeakMessages
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/** `workosBootstrap:ensureUser`: links a new WorkOS sign-in to a Teak account before it's saved. */
interface UserBootstrap {
    /** Returns normally once the account is ready; throws [SignInException] with a message to show. */
    suspend fun ensureUser(accessToken: String)
}

@Singleton
class ConvexUserBootstrap @Inject constructor(
    private val httpClient: OkHttpClient,
    private val config: TeakConfig,
) : UserBootstrap {
    override suspend fun ensureUser(accessToken: String) {
        repeat(PROFILE_PENDING_RETRIES + 1) { attempt ->
            val result = call(accessToken)
            val status = result["status"]?.jsonPrimitive?.content
            val reason = result["reason"]?.jsonPrimitive?.content
            when {
                status == "ok" -> return
                status == "verify_email" -> throw SignInException("Verify your email before opening your vault.")
                status == "frozen" -> throw SignInException(TeakMessages.SIGNUPS_PAUSED)
                // A brand-new account's profile arrives by webhook a moment after sign-up.
                status == "quarantined" && reason == "profile_pending" && attempt < PROFILE_PENDING_RETRIES ->
                    delay(PROFILE_PENDING_DELAY_MS)
                else -> throw SignInException(UNABLE_TO_OPEN_VAULT)
            }
        }
        throw SignInException(UNABLE_TO_OPEN_VAULT)
    }

    /** Convex's HTTP API, so the token is used once without touching the app's live connection. */
    private suspend fun call(accessToken: String): JsonObject = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("path", "workosBootstrap:ensureUser")
            put("args", JsonObject(emptyMap()))
            put("format", "json")
        }.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("${config.convexUrl.trimEnd('/')}/api/mutation")
            .header("Authorization", "Bearer $accessToken")
            .post(body)
            .build()
        try {
            httpClient.newCall(request).execute().use { response ->
                val root = Json.parseToJsonElement(response.body?.string().orEmpty()).jsonObject
                if (root["status"]?.jsonPrimitive?.content != "success") throw SignInException(UNABLE_TO_OPEN_VAULT)
                root["value"]?.jsonObject ?: throw SignInException(UNABLE_TO_OPEN_VAULT)
            }
        } catch (e: IOException) {
            throw SignInException("Unable to connect. Please try again.", e)
        } catch (e: IllegalArgumentException) {
            throw SignInException(UNABLE_TO_OPEN_VAULT, e)
        }
    }

    companion object {
        const val PROFILE_PENDING_RETRIES = 8
        const val PROFILE_PENDING_DELAY_MS = 1_500L
        const val UNABLE_TO_OPEN_VAULT = "Unable to open your vault. Please try again or contact support."
    }
}
