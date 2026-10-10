package com.praveenjuge.teak.core.data.convex

import android.content.Context
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.di.ApplicationScope
import dev.convex.android.AuthProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Hands WorkOS access tokens to Convex. The session manager does the signing in; this only
 * passes along the current token and every refreshed one, and null when the session ends.
 */
@Singleton
class WorkOsConvexAuthProvider @Inject constructor(
    private val sessions: SessionManager,
    @ApplicationScope private val scope: CoroutineScope,
) : AuthProvider<String> {
    private var listener: Job? = null

    override suspend fun login(context: Context, onIdToken: (String?) -> Unit): Result<String> =
        loginFromCache(onIdToken)

    override suspend fun loginFromCache(onIdToken: (String?) -> Unit): Result<String> {
        listener?.cancel()
        listener = scope.launch { sessions.tokens.collect { onIdToken(it) } }
        return runCatching { sessions.accessToken() ?: throw IllegalStateException("Signed out") }
    }

    override suspend fun logout(context: Context): Result<Void?> {
        listener?.cancel()
        listener = null
        return Result.success(null)
    }

    override fun extractIdToken(authResult: String): String = authResult
}
