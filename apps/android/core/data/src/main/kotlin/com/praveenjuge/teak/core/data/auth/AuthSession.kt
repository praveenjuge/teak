package com.praveenjuge.teak.core.data.auth

import kotlinx.serialization.Serializable

@Serializable
data class SessionUser(
    val id: String,
    val email: String,
    val emailVerified: Boolean,
    val name: String,
    /** The Teak account this WorkOS user is linked to, once `ensureUser` has linked it. */
    val teakUserId: String? = null,
)

@Serializable
data class AuthSession(
    val clientId: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
    /** The AuthKit `sid` claim, used to revoke this device's session on sign-out. */
    val sessionId: String,
    val user: SessionUser,
) {
    override fun toString(): String = "AuthSession(user=${user.id}, sessionId=$sessionId)"

    /** False when [other] belongs to a different WorkOS user, session, or linked Teak account. */
    fun isSameAccount(other: AuthSession): Boolean =
        other.user.id == user.id && other.sessionId == sessionId &&
            (user.teakUserId == null || other.user.teakUserId == user.teakUserId)
}

@Serializable
data class PendingSignIn(
    val clientId: String,
    val codeVerifier: String,
    val state: String,
)

enum class SignInMethod(val provider: String, val screenHint: String?) {
    Apple("AppleOAuth", null),
    Google("GoogleOAuth", null),
    EmailSignIn("authkit", "sign-in"),
    EmailSignUp("authkit", "sign-up"),
}

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val user: SessionUser) : SessionState
}

class SignInException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** WorkOS rejected the refresh token: the session is over and must be cleared. */
class InvalidRefreshTokenException : Exception("Your session ended. Please sign in again.")
