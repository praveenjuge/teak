package com.praveenjuge.teak.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.repository.AccountRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WelcomeUiState(
    val isConfigured: Boolean = false,
    val signupsDisabled: Boolean = false,
    val pending: SignInMethod? = null,
    val error: String? = null,
)

@HiltViewModel
class WelcomeViewModel @Inject constructor(
    account: AccountRepository,
    private val controller: SignInController,
) : ViewModel() {
    val uiState: StateFlow<WelcomeUiState> = combine(account.authMode, controller.progress) { mode, progress ->
        WelcomeUiState(
            isConfigured = mode?.validClientId != null,
            signupsDisabled = mode?.signupsDisabled == true,
            pending = progress.pending,
            error = progress.error,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WelcomeUiState())

    private val _openUrl = Channel<String>(Channel.BUFFERED)
    /** AuthKit URLs to open in a Custom Tab. */
    val openUrl = _openUrl.receiveAsFlow()

    fun signIn(method: SignInMethod) {
        if (uiState.value.pending != null) return
        viewModelScope.launch {
            controller.start(method)?.let { _openUrl.send(it) }
        }
    }

    /** Back in the app with no redirect: the person closed the browser. */
    fun onReturnedWithoutRedirect() = controller.cancel()

    fun dismissError() = controller.dismissError()
}
