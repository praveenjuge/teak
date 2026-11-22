package com.praveenjuge.teak

import android.app.UiModeManager
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
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.LanguageRepository
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.feature.auth.SignInController
import com.praveenjuge.teak.feature.capture.CapturePick
import com.praveenjuge.teak.ui.LaunchRequest
import com.praveenjuge.teak.ui.TeakApp
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var account: AccountRepository
    @Inject lateinit var preferences: PreferencesRepository
    @Inject lateinit var signIn: SignInController
    @Inject lateinit var language: LanguageRepository
    @Inject @ApplicationScope lateinit var appScope: CoroutineScope

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
        // Android keeps the app's own night mode, so the window and the splash screen match Teak's theme too.
        lifecycleScope.launch {
            preferences.theme.distinctUntilChanged().collect { theme ->
                getSystemService(UiModeManager::class.java).setApplicationNightMode(
                    when (theme) {
                        ThemePreference.System -> UiModeManager.MODE_NIGHT_AUTO
                        ThemePreference.Light -> UiModeManager.MODE_NIGHT_NO
                        ThemePreference.Dark -> UiModeManager.MODE_NIGHT_YES
                    },
                )
            }
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
            val wallpaperColors by preferences.useWallpaperColors.collectAsStateWithLifecycle(false)
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
            TeakTheme(darkTheme = dark, wallpaperColors = wallpaperColors) {
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
            // The code can be spent only once, so finishing sign-in outlives a rotation or a closed activity. It starts
            // on the main thread right away, so it's marked as completing before onResume could cancel it.
            SignInController.isCallback(uri) -> appScope.launch(Dispatchers.Main.immediate) { signIn.handleCallback(requireNotNull(uri)) }
            else -> launchRequest(intent)?.let { launchRequest.value = it }
        }
    }

    companion object {
        const val ACTION_NEW_NOTE = "com.praveenjuge.teak.action.NEW_NOTE"
        const val ACTION_VOICE_MEMO = "com.praveenjuge.teak.action.VOICE_MEMO"
        const val ACTION_PHOTOS = "com.praveenjuge.teak.action.PHOTOS"
        const val ACTION_CAMERA = "com.praveenjuge.teak.action.CAMERA"
        const val ACTION_FILES = "com.praveenjuge.teak.action.FILES"
        const val ACTION_OPEN_CARD = "com.praveenjuge.teak.action.OPEN_CARD"
        const val EXTRA_CARD_ID = "com.praveenjuge.teak.extra.CARD_ID"

        private val cardId = Regex("[a-z0-9]{16,64}")

        /** The screen a shortcut's or a widget's intent asks for, or null for any other intent. */
        fun launchRequest(intent: Intent?): LaunchRequest? = when (intent?.action) {
            ACTION_NEW_NOTE -> LaunchRequest.NewNote
            ACTION_VOICE_MEMO -> LaunchRequest.VoiceMemo
            ACTION_PHOTOS -> LaunchRequest.Capture(CapturePick.Photos)
            ACTION_CAMERA -> LaunchRequest.Capture(CapturePick.Camera)
            ACTION_FILES -> LaunchRequest.Capture(CapturePick.Files)
            ACTION_OPEN_CARD -> intent.getStringExtra(EXTRA_CARD_ID)?.takeIf(cardId::matches)?.let(LaunchRequest::OpenCard)
            else -> null
        }
    }
}
