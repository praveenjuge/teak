package com.praveenjuge.teak.core.data.repository

import android.content.Context
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SignInException
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.CurrentUser
import com.praveenjuge.teak.core.model.TeakMessages
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.builtins.nullable
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Who is signed in, how to sign in, and the account itself. */
interface AccountRepository {
    val session: StateFlow<SessionState>
    val authMode: StateFlow<AuthMode?>
    val currentUser: Flow<Result<CurrentUser?>>
    val isConnected: Flow<Boolean>

    /** Restores the saved session and connects Convex. Called once at launch. */
    suspend fun start()

    /** The AuthKit URL to open in a Custom Tab. */
    suspend fun signInUrl(method: SignInMethod): String

    /** Handles the `teak://auth/callback` redirect. Returns false when the person cancelled. */
    suspend fun completeSignIn(code: String?, state: String?, error: String?): Boolean

    suspend fun signOut()

    /** Deletes the account and everything in it, then signs out this device. */
    suspend fun deleteAccount()
}

@Singleton
class ConvexAccountRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val sessions: SessionManager,
    private val convex: ConvexApi,
    private val client: ConvexClientWithAuth<String>,
    private val preferences: PreferencesRepository,
    @ApplicationScope private val scope: CoroutineScope,
) : AccountRepository {
    override val session: StateFlow<SessionState> = sessions.state

    private val _authMode = MutableStateFlow<AuthMode?>(null)
    override val authMode: StateFlow<AuthMode?> = _authMode.asStateFlow()

    override val currentUser: Flow<Result<CurrentUser?>> =
        convex.subscribe("auth:getCurrentUser").map { result ->
            result.mapCatching { teakJson.decodeFromJsonElement(CurrentUser.serializer().nullable, it) }
        }

    override val isConnected: Flow<Boolean> = convex.isConnected.distinctUntilChanged()

    override suspend fun start() {
        preferences.cachedAuthMode()?.let { cached ->
            runCatching { teakJson.decodeFromString(AuthMode.serializer(), cached) }.getOrNull()
                ?.let { _authMode.value = it }
        }
        scope.launch {
            convex.subscribe("auth:getAuthMode").collect { result ->
                val mode = result.getOrNull()?.let {
                    runCatching { teakJson.decodeFromJsonElement(AuthMode.serializer(), it) }.getOrNull()
                } ?: return@collect
                val previousClient = _authMode.value?.validClientId
                _authMode.value = mode
                preferences.cacheAuthMode(teakJson.encodeToString(AuthMode.serializer(), mode))
                // A deployment that switched WorkOS clients can't use the old client's session.
                val stored = sessions.currentSession
                if (stored != null && previousClient != null && mode.validClientId != previousClient &&
                    stored.clientId != mode.validClientId
                ) {
                    sessions.clear()
                    client.logout(context)
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
            ?: throw SignInException("Unable to load sign-in configuration")
        return sessions.beginSignIn(clientId, method)
    }

    override suspend fun completeSignIn(code: String?, state: String?, error: String?): Boolean {
        val signedIn = sessions.completeSignIn(code, state, error)
        if (signedIn) client.loginFromCache()
        return signedIn
    }

    override suspend fun signOut() {
        val current = sessions.currentSession
        if (current != null) {
            // Revoke this device's session on the server first; a failure (say, offline) still signs out locally.
            runCatching {
                sessions.accessToken()
                convex.action("securitySessions:revokeAuthkitSession", mapOf("sessionId" to current.sessionId))
            }
        }
        sessions.clear()
        client.logout(context)
    }

    override suspend fun deleteAccount() {
        if (_authMode.value?.accountChangesPaused == true) {
            throw TeakException(null, TeakMessages.ACCOUNT_CHANGES_PAUSED)
        }
        convex.mutation("accountDeletion:deleteMyAccount")
        // The server already removed the session along with the account.
        sessions.clear()
        client.logout(context)
    }
}
