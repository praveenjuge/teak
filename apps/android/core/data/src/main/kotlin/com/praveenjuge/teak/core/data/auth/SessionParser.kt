package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.model.UiText
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.util.Base64

object SessionParser {
    private val json = Json { ignoreUnknownKeys = true }

    private fun invalidToken(cause: Throwable? = null) =
        SignInException("Invalid session token", cause, UiText.of("native.errors.invalidSessionToken"))

    private fun invalidResponse(cause: Throwable? = null) =
        SignInException("Invalid sign-in response", cause, UiText.of("native.errors.invalidSignInResponse"))

    data class TokenUser(
        val id: String,
        val email: String,
        val emailVerified: Boolean,
        val firstName: String?,
        val lastName: String?,
        val externalId: String?,
    )

    fun parse(clientId: String, accessToken: String, refreshToken: String, user: TokenUser): AuthSession {
        val parts = accessToken.split('.')
        if (parts.size != 3 || refreshToken.isEmpty()) throw invalidToken()
        val claims = try {
            json.parseToJsonElement(String(Base64.getUrlDecoder().decode(parts[1].trimEnd('=')))).jsonObject
        } catch (e: IllegalArgumentException) {
            throw invalidToken(e)
        }
        val sid = claims.string("sid")
        val exp = (claims["exp"] as? JsonPrimitive)?.longOrNull
        if (claims.string("iss") != "https://api.workos.com/user_management/$clientId" ||
            claims.string("sub") != user.id ||
            sid == null || !sid.startsWith("session_") ||
            exp == null || exp <= 0 || exp > Long.MAX_VALUE / 1000
        ) {
            throw invalidToken()
        }
        return AuthSession(
            clientId = clientId,
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAtMillis = exp * 1000,
            sessionId = sid,
            user = SessionUser(
                id = user.id,
                email = user.email,
                emailVerified = user.emailVerified,
                name = listOfNotNull(user.firstName, user.lastName).joinToString(" "),
                teakUserId = user.externalId,
            ),
        )
    }

    fun parseResponse(clientId: String, body: String): AuthSession {
        val root = try {
            json.parseToJsonElement(body).jsonObject
        } catch (e: IllegalArgumentException) {
            throw invalidResponse(e)
        }
        val user = root["user"] as? JsonObject ?: throw invalidResponse()
        return parse(
            clientId = clientId,
            accessToken = root.string("access_token") ?: throw invalidResponse(),
            refreshToken = root.string("refresh_token") ?: throw invalidResponse(),
            user = TokenUser(
                id = user.string("id") ?: throw invalidResponse(),
                email = user.string("email") ?: throw invalidResponse(),
                emailVerified = (user["email_verified"] as? JsonPrimitive)?.booleanOrNull
                    ?: throw invalidResponse(),
                firstName = user.string("first_name"),
                lastName = user.string("last_name"),
                externalId = user.string("external_id"),
            ),
        )
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
}
