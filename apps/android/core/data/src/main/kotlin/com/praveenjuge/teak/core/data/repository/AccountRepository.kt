package com.praveenjuge.teak.core.data.repository

import android.content.Context
import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SignInException
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.auth.SignInOutcome
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.action
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.CurrentUser
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton

interface AccountRepository {
    val session: StateFlow<SessionState>
    val authMode: StateFlow<AuthMode?>
    val currentUser: Flow<Result<CurrentUser?>>
    val isConnected: Flow<Boolean>

    suspend fun start()

    suspend fun signInUrl(method: SignInMethod): String

    suspend fun completeSignIn(code: String?, state: String?, error: String?): SignInOutcome

    suspend fun signOut()

    suspend fun deleteAccount()
}

@Singleton
class ConvexAccountRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val sessions: SessionManager,
    private val convex: ConvexApi,
    private val client: ConvexClientWithAuth<String>,
    private val preferences: PreferencesRepository,
    private val uploads: UploadRepository,
    @ApplicationScope private val scope: CoroutineScope,
) : AccountRepository {
    override val session: StateFlow<SessionState> = sessions.state

    private val _authMode = MutableStateFlow<AuthMode?>(null)
    override val authMode: StateFlow<AuthMode?> = _authMode.asStateFlow()

    override val currentUser: Flow<Result<CurrentUser?>> = convex.subscribe(ConvexFunctions.getCurrentUser)

    override val isConnected: Flow<Boolean> = convex.isConnected.distinctUntilChanged()

    override suspend fun start() {
        preferences.cachedAuthMode()?.let { cached ->
            runCatching { teakJson.decodeFromString(AuthMode.serializer(), cached) }.getOrNull()
                ?.let { _authMode.value = it }
        }
        scope.launch {
            convex.subscribe(ConvexFunctions.getAuthMode).collect { result ->
                val mode = result.getOrNull() ?: return@collect
                val previousClient = _authMode.value?.validClientId
                _authMode.value = mode
                preferences.cacheAuthMode(teakJson.encodeToString(AuthMode.serializer(), mode))
                if (previousClient != null && mode.validClientId != previousClient) {
                    dropSessionIssuedByOtherClient(mode.validClientId)
                }
            }
        }
        sessions.restore()
        if (sessions.state.value is SessionState.SignedIn) {
            client.loginFromCache()
        }
    }

    override suspend fun signInUrl(method: SignInMethod): String {
        val clientId = _authMode.value?.validClientId
            ?: throw SignInException.signInConfig()
        return sessions.beginSignIn(clientId, method)
    }

    override suspend fun completeSignIn(code: String?, state: String?, error: String?): SignInOutcome {
        val outcome = sessions.completeSignIn(code, state, error)
        if (outcome == SignInOutcome.SignedIn) client.loginFromCache()
        return outcome
    }

    override suspend fun signOut() {
        sessions.currentSession?.let { revokeOnServerBestEffort(it) }
        clearLocalSession()
    }

    override suspend fun deleteAccount() {
        convex.mutation(ConvexFunctions.deleteMyAccount)
        clearLocalSession()
    }

    private suspend fun dropSessionIssuedByOtherClient(clientId: String?) {
        val stored = sessions.currentSession ?: return
        if (stored.clientId != clientId) clearLocalSession()
    }

    /** Signing out doesn't wait on the server for long: offline, the request could hang until the socket gives up. */
    private suspend fun revokeOnServerBestEffort(session: AuthSession) {
        withTimeoutOrNull(REVOKE_TIMEOUT_MS) {
            catchingFailures {
                sessions.accessToken()
                convex.action(ConvexFunctions.revokeAuthkitSession, mapOf("sessionId" to session.sessionId))
            }
        }
    }

    /** Files still queued belong to the account that's leaving, so they're dropped rather than uploaded into the next one. */
    private suspend fun clearLocalSession() {
        sessions.clear()
        client.logout(context)
        uploads.discardAll()
    }

    private companion object {
        const val REVOKE_TIMEOUT_MS = 5_000L
    }
}
