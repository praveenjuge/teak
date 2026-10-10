package com.praveenjuge.teak.core.data.auth

import com.workos.android.Configuration
import com.workos.android.WorkOSClient
import com.workos.android.enums.UserManagementAuthenticationProvider
import com.workos.android.enums.UserManagementAuthenticationScreenHint
import com.workos.android.helpers.getAuthorizationUrlWithPkce
import com.workos.android.userManagement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObjectBuilder
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
import javax.inject.Named
import javax.inject.Singleton

/** WorkOS AuthKit as a public (PKCE) client: no API key or client secret ever ships in the app. */
interface WorkOsAuthApi {
    /** The AuthKit URL to open in a Custom Tab, plus the PKCE values to keep until the redirect. */
    fun startSignIn(clientId: String, method: SignInMethod): Pair<String, PendingSignIn>

    suspend fun exchangeCode(pending: PendingSignIn, code: String): AuthSession

    /** Throws [InvalidRefreshTokenException] when WorkOS rejects the token, [IOException] when offline. */
    suspend fun refresh(clientId: String, refreshToken: String): AuthSession
}

@Singleton
class DefaultWorkOsAuthApi @Inject constructor(
    private val httpClient: OkHttpClient,
    @Named(WORKOS_BASE_URL) private val baseUrl: String,
) : WorkOsAuthApi {
    private fun client(clientId: String) =
        WorkOSClient(Configuration(apiKey = "", baseUrl = baseUrl, clientId = clientId))

    override fun startSignIn(clientId: String, method: SignInMethod): Pair<String, PendingSignIn> {
        val start = client(clientId).userManagement.getAuthorizationUrlWithPkce(
            redirectUri = REDIRECT_URI,
            provider = UserManagementAuthenticationProvider.fromRawValue(method.provider),
            screenHint = method.screenHint?.let(UserManagementAuthenticationScreenHint::fromRawValue),
        )
        return start.url to PendingSignIn(clientId, start.codeVerifier, start.state)
    }

    // The SDK (0.4.0) builds the PKCE authorize URL. Its token calls always send `client_secret`,
    // which WorkOS rejects as empty for public clients, so both grants are posted directly, as on iOS.
    override suspend fun exchangeCode(pending: PendingSignIn, code: String): AuthSession = try {
        authenticate(pending.clientId) {
            put("grant_type", "authorization_code")
            put("code", code)
            put("code_verifier", pending.codeVerifier)
        }
    } catch (e: InvalidRefreshTokenException) {
        throw SignInException(UNABLE_TO_SIGN_IN, e)
    } catch (e: IOException) {
        throw SignInException("Unable to connect. Please try again.", e)
    }

    override suspend fun refresh(clientId: String, refreshToken: String): AuthSession =
        authenticate(clientId) {
            put("grant_type", "refresh_token")
            put("refresh_token", refreshToken)
        }

    private suspend fun authenticate(clientId: String, fields: JsonObjectBuilder.() -> Unit): AuthSession =
        withContext(Dispatchers.IO) {
            val body = buildJsonObject {
                put("client_id", clientId)
                fields()
            }.toString().toRequestBody(JSON)
            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/user_management/authenticate")
                .post(body)
                .build()
            httpClient.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (text.length > MAX_RESPONSE) throw SignInException(UNABLE_TO_SIGN_IN)
                if (!response.isSuccessful) {
                    val error = runCatching {
                        val root = Json.parseToJsonElement(text).jsonObject
                        root["error"]?.jsonPrimitive?.content ?: root["code"]?.jsonPrimitive?.content
                    }.getOrNull()
                    if (response.code == 401 || error == "invalid_grant" || error == "invalid_refresh_token") {
                        throw InvalidRefreshTokenException()
                    }
                    throw IOException("WorkOS authenticate failed with status ${response.code} ($error)")
                }
                SessionParser.parseResponse(clientId, text)
            }
        }

    companion object {
        const val WORKOS_BASE_URL = "workosBaseUrl"
        const val REDIRECT_URI = "teak://auth/callback"
        const val UNABLE_TO_SIGN_IN = "Unable to complete sign-in. Please try again."
        private const val MAX_RESPONSE = 64 * 1024
        private val JSON = "application/json".toMediaType()
    }
}
