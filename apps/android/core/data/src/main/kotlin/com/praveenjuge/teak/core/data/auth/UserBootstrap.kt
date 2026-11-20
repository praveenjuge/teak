package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
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
    /**
     * Returns normally once the account is ready; throws [SignInException] with a message to show. [authMethod] is
     * WorkOS's `authentication_method` from the code exchange, for a new account's `user_signed_up`.
     */
    suspend fun ensureUser(accessToken: String, authMethod: String? = null)
}

@Singleton
class ConvexUserBootstrap @Inject constructor(
    private val httpClient: OkHttpClient,
    private val config: TeakConfig,
) : UserBootstrap {
    override suspend fun ensureUser(accessToken: String, authMethod: String?) {
        val signup = buildJsonObject {
            put("platform", "android")
            authMethod?.let { put("authMethod", it) }
        }
        // A backend deployed before `ensureUserWithSignup` doesn't have it, so the sign-in carries on through
        // `ensureUser`, as on the web.
        val result = call(accessToken, ConvexFunctions.ensureUserWithSignup.name, signup)
            ?: call(accessToken, ConvexFunctions.ensureUser.name, JsonObject(emptyMap()))
            ?: throw SignInException.vaultUnavailable()
        when (result["status"]?.jsonPrimitive?.content) {
            "ok" -> return
            "verify_email" -> throw SignInException.verifyEmail()
            "frozen" -> throw SignInException.signupsPaused()
            else -> throw SignInException.vaultUnavailable()
        }
    }

    /** The mutation's result, or null when the backend has no such function yet. */
    private suspend fun call(accessToken: String, path: String, args: JsonObject): JsonObject? = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("path", path)
            put("args", args)
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
                if (root["status"]?.jsonPrimitive?.content != "success") {
                    val message = root["errorMessage"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    if (message.contains("Could not find public function")) return@use null
                    throw SignInException.vaultUnavailable()
                }
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
