package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import kotlinx.coroutines.Dispatchers
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
        when (call(accessToken)["status"]?.jsonPrimitive?.content) {
            "ok" -> return
            "verify_email" -> throw SignInException.verifyEmail()
            "frozen" -> throw SignInException.signupsPaused()
            else -> throw SignInException.vaultUnavailable()
        }
    }

    private suspend fun call(accessToken: String): JsonObject = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("path", ConvexFunctions.ensureUser.name)
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
                if (root["status"]?.jsonPrimitive?.content != "success") throw SignInException.vaultUnavailable()
                root["value"]?.jsonObject ?: throw SignInException.vaultUnavailable()
            }
        } catch (e: IOException) {
            throw SignInException.connectFailed(e)
        } catch (e: IllegalArgumentException) {
            throw SignInException.vaultUnavailable(e)
        }
    }

    companion object {
        const val UNABLE_TO_OPEN_VAULT = "Unable to open your vault. Please try again or contact support."
    }
}
