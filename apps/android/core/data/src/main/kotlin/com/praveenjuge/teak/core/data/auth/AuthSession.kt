package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.model.SIGNUPS_PAUSED_MESSAGE
import com.praveenjuge.teak.core.model.UiText
import kotlinx.serialization.Serializable

@Serializable
data class SessionUser(
    val id: String,
    val email: String,
    val emailVerified: Boolean,
    val name: String,
    val teakUserId: String? = null,
)

@Serializable
data class AuthSession(
    val clientId: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
    val sessionId: String,
    val user: SessionUser,
) {
    override fun toString(): String = "AuthSession(user=${user.id}, sessionId=$sessionId)"

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

/** [message] stays English for logs; [text] is what to show. */
class SignInException(
    message: String,
    cause: Throwable? = null,
    val text: UiText = UiText.verbatim(message),
) : Exception(message, cause) {
    companion object {
        fun signInFailed(cause: Throwable? = null) =
            SignInException(DefaultWorkOsAuthApi.UNABLE_TO_SIGN_IN, cause, UiText.of("native.errors.signInFailed"))

        fun connectFailed(cause: Throwable? = null) =
            SignInException("Unable to connect. Please try again.", cause, UiText.of("native.errors.connectFailed"))

        fun vaultUnavailable(cause: Throwable? = null) =
            SignInException(ConvexUserBootstrap.UNABLE_TO_OPEN_VAULT, cause, UiText.of("native.errors.vaultUnavailable"))

        fun verifyEmail() = SignInException("Verify your email before opening your vault.", text = UiText.of("native.errors.verifyEmail"))

        fun signupsPaused() = SignInException(SIGNUPS_PAUSED_MESSAGE, text = UiText.of("native.errors.signupsPaused"))

        fun signInConfig() = SignInException("Unable to load sign-in configuration", text = UiText.of("native.errors.signInConfig"))
    }
}

class InvalidRefreshTokenException : Exception("Your session ended. Please sign in again.") {
    val text: UiText get() = UiText.of("native.errors.sessionEnded")
}
