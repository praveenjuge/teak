package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SessionUser
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.CurrentUser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class FakeAccountRepository(
    signedIn: Boolean = true,
) : AccountRepository {
    val user = SessionUser(id = "user_1", email = "ada@example.com", emailVerified = true, name = "Ada", teakUserId = "teak_1")
    override val session = MutableStateFlow<SessionState>(if (signedIn) SessionState.SignedIn(user) else SessionState.SignedOut)
    override val authMode = MutableStateFlow<AuthMode?>(
        AuthMode(primary = "workos", signupsDisabled = false, accountChangesPaused = false, authKitClientId = "client_123"),
    )
    val currentUserFlow = MutableStateFlow<Result<CurrentUser?>>(
        Result.success(CurrentUser(id = "teak_1", email = "ada@example.com", cardCount = 12.0)),
    )
    override val currentUser: Flow<Result<CurrentUser?>> = currentUserFlow
    override val isConnected = MutableStateFlow(true)

    val signInMethods = mutableListOf<SignInMethod>()
    var signInError: Exception? = null
    var deleteError: Exception? = null
    var signedOut = false
    var deleted = false

    override suspend fun start() = Unit

    override suspend fun signInUrl(method: SignInMethod): String {
        signInError?.let { throw it }
        signInMethods += method
        return "https://auth.example.com/authorize?provider=${method.provider}"
    }

    override suspend fun completeSignIn(code: String?, state: String?, error: String?): Boolean {
        signInError?.let { throw it }
        if (error != null) return false
        session.value = SessionState.SignedIn(user)
        return true
    }

    override suspend fun signOut() {
        signedOut = true
        session.value = SessionState.SignedOut
    }

    override suspend fun deleteAccount() {
        deleteError?.let { throw it }
        deleted = true
        session.value = SessionState.SignedOut
    }
}
