package com.praveenjuge.teak

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.feature.auth.SignInController
import com.praveenjuge.teak.ui.LaunchRequest
import com.praveenjuge.teak.ui.TeakApp
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var account: AccountRepository
    @Inject lateinit var preferences: PreferencesRepository
    @Inject lateinit var signIn: SignInController

    /** Something the launch asked for: a new note from the app shortcut, for example. */
    private val launchRequest = MutableStateFlow<LaunchRequest?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { account.session.value == SessionState.Loading }
        enableEdgeToEdge()
        if (savedInstanceState == null) handle(intent)
        setContent {
            val theme by preferences.theme.collectAsStateWithLifecycle(ThemePreference.System)
            val dark = when (theme) {
                ThemePreference.System -> isSystemInDarkTheme()
                ThemePreference.Light -> false
                ThemePreference.Dark -> true
            }
            TeakTheme(darkTheme = dark) {
                TeakApp(
                    account = account,
                    launchRequest = launchRequest,
                    onLaunchRequestHandled = { launchRequest.value = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val uri = intent?.data
        when {
            SignInController.isCallback(uri) -> lifecycleScope.launch { signIn.handleCallback(requireNotNull(uri)) }
            intent?.action == ACTION_NEW_NOTE -> launchRequest.value = LaunchRequest.NewNote
            intent?.action == ACTION_VOICE_MEMO -> launchRequest.value = LaunchRequest.VoiceMemo
        }
    }

    companion object {
        const val ACTION_NEW_NOTE = "com.praveenjuge.teak.action.NEW_NOTE"
        const val ACTION_VOICE_MEMO = "com.praveenjuge.teak.action.VOICE_MEMO"
    }
}
