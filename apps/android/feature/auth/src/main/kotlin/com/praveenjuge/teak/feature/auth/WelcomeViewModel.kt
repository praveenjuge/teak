package com.praveenjuge.teak.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.model.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WelcomeUiState(
    val isConfigured: Boolean = false,
    val signupsDisabled: Boolean = false,
    val pending: SignInMethod? = null,
    val error: UiText? = null,
    /** Offline before the sign-in setup ever loaded, so the buttons can't show yet. */
    val isOffline: Boolean = false,
)

@HiltViewModel
class WelcomeViewModel @Inject constructor(
    account: AccountRepository,
    private val controller: SignInController,
) : ViewModel() {
    // A short grace period keeps the message from flashing while the connection is still opening.
    private val offline = account.isConnected.mapLatest { connected ->
        if (!connected) delay(OFFLINE_GRACE_MS)
        !connected
    }

    val uiState: StateFlow<WelcomeUiState> = combine(account.authMode, controller.progress, offline) { mode, progress, offline ->
        val configured = mode?.validClientId != null
        WelcomeUiState(
            isConfigured = configured,
            signupsDisabled = mode?.signupsDisabled == true,
            pending = progress.pending,
            error = progress.error,
            isOffline = !configured && offline,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WelcomeUiState())

    private val _openUrl = Channel<String>(Channel.BUFFERED)
    val openUrl = _openUrl.receiveAsFlow()

    fun signIn(method: SignInMethod) {
        if (uiState.value.pending != null) return
        viewModelScope.launch {
            controller.start(method)?.let { _openUrl.send(it) }
        }
    }

    fun onReturnedWithoutRedirect() = controller.cancel()

    fun onSignInPageUnavailable() = controller.failToOpen()

    fun dismissError() = controller.dismissError()

    private companion object {
        const val OFFLINE_GRACE_MS = 3_000L
    }
}
