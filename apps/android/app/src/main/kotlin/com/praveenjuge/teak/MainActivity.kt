package com.praveenjuge.teak

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.graphics.Color
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.LanguageRepository
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.core.i18n.AppLanguage
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
    @Inject lateinit var language: LanguageRepository

    private val launchRequest = MutableStateFlow<LaunchRequest?>(null)

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLanguage.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        keepSplashScreenWhileLoading()
        enableEdgeToEdge()
        if (savedInstanceState == null) handle(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { language.follow() }
        }
        // Android 13 and later recreate the activity in a new language themselves.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            lifecycleScope.launch {
                language.current.collect { code ->
                    if (code != AppLanguage.match(resources.configuration.locales)) recreate()
                }
            }
        }
        setContent {
            val theme by preferences.theme.collectAsStateWithLifecycle(ThemePreference.System)
            val dark = when (theme) {
                ThemePreference.System -> isSystemInDarkTheme()
                ThemePreference.Light -> false
                ThemePreference.Dark -> true
            }
            DisposableEffect(dark) {
                val style = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose {}
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

    // The platform splash screen comes from Theme.Teak.Starting and stays until the first frame
    // draws. androidx core-splashscreen is not used: with minSdk 31, R8 drops its API check, so
    // its API 31 listener crashed devices that report an older Android.
    private fun keepSplashScreenWhileLoading() {
        val content = findViewById<View>(android.R.id.content)
        content.viewTreeObserver.addOnPreDrawListener(
            object : ViewTreeObserver.OnPreDrawListener {
                override fun onPreDraw(): Boolean {
                    if (account.session.value == SessionState.Loading) return false
                    content.viewTreeObserver.removeOnPreDrawListener(this)
                    return true
                }
            },
        )
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
