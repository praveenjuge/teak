package com.praveenjuge.teak.feature.auth

import android.net.Uri
import com.praveenjuge.teak.core.data.auth.SignInException
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.repository.AccountRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

data class SignInProgress(
    val pending: SignInMethod? = null,
    val error: String? = null,
)

/**
 * Tracks one sign-in from the button press to the `teak://auth/callback` redirect, which arrives
 * in the activity rather than the screen that started it.
 */
@Singleton
class SignInController @Inject constructor(
    private val account: AccountRepository,
) {
    private val _progress = MutableStateFlow(SignInProgress())
    private var completing = false
    val progress: StateFlow<SignInProgress> = _progress.asStateFlow()

    /** Returns the AuthKit URL to open, or null after showing an error. */
    suspend fun start(method: SignInMethod): String? {
        _progress.value = SignInProgress(pending = method)
        return try {
            account.signInUrl(method)
        } catch (e: SignInException) {
            _progress.value = SignInProgress(error = e.message)
            null
        }
    }

    /** Handles the redirect from AuthKit. */
    suspend fun handleCallback(uri: Uri) {
        val method = _progress.value.pending
        completing = true
        _progress.value = SignInProgress(pending = method ?: SignInMethod.EmailSignIn)
        _progress.value = try {
            account.completeSignIn(
                code = uri.getQueryParameter("code"),
                state = uri.getQueryParameter("state"),
                error = uri.getQueryParameter("error"),
            )
            SignInProgress()
        } catch (e: Exception) {
            SignInProgress(error = e.message ?: "Unable to complete sign-in. Please try again.")
        } finally {
            completing = false
        }
    }

    /** The browser was closed without finishing. */
    fun cancel() {
        if (!completing && _progress.value.pending != null) _progress.value = SignInProgress()
    }

    fun dismissError() {
        _progress.value = _progress.value.copy(error = null)
    }

    companion object {
        fun isCallback(uri: Uri?): Boolean =
            uri?.scheme == "teak" && uri.host == "auth" && uri.path == "/callback"
    }
}
