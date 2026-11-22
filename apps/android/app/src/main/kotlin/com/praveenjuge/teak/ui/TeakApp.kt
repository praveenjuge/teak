package com.praveenjuge.teak.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.feature.auth.WelcomeRoute
import com.praveenjuge.teak.feature.capture.CapturePick
import kotlinx.coroutines.flow.StateFlow

/** What a launcher shortcut or a widget opens the app on. */
sealed interface LaunchRequest {
    data object NewNote : LaunchRequest
    data object VoiceMemo : LaunchRequest
    data class Capture(val pick: CapturePick) : LaunchRequest
    data class OpenCard(val id: String) : LaunchRequest
}

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
