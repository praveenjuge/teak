package com.praveenjuge.teak.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.feature.auth.WelcomeRoute
import kotlinx.coroutines.flow.StateFlow

/** Something a launch intent asked for, handled once the library is showing. */
enum class LaunchRequest { NewNote, VoiceMemo }

/** Shows sign-in until there's a session, then the library. */
@Composable
fun TeakApp(
    account: AccountRepository,
    launchRequest: StateFlow<LaunchRequest?>,
    onLaunchRequestHandled: () -> Unit,
) {
    val session by account.session.collectAsStateWithLifecycle()
    when (session) {
        SessionState.Loading -> TeakLoading()
        SessionState.SignedOut -> WelcomeRoute()
        is SessionState.SignedIn -> {
            val request by launchRequest.collectAsStateWithLifecycle()
            TeakNavigation(launchRequest = request, onLaunchRequestHandled = onLaunchRequestHandled)
        }
    }
}
