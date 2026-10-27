package com.praveenjuge.teak.feature.capture.share

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.designsystem.theme.TeakTheme
import com.praveenjuge.teak.core.i18n.AppLanguage
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class ShareActivity : ComponentActivity() {
    private val viewModel: ShareViewModel by viewModels()

    @Inject lateinit var preferences: PreferencesRepository

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLanguage.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ShareIntents.processTextReply(intent)?.let { setResult(RESULT_OK, it) }
        viewModel.start(ShareIntents.items(intent))
        setContent {
            val theme by preferences.theme.collectAsStateWithLifecycle(ThemePreference.System)
            val wallpaperColors by preferences.useWallpaperColors.collectAsStateWithLifecycle(false)
            val dark = when (theme) {
                ThemePreference.System -> isSystemInDarkTheme()
                ThemePreference.Light -> false
                ThemePreference.Dark -> true
            }
            TeakTheme(darkTheme = dark, wallpaperColors = wallpaperColors) {
                val state by viewModel.uiState.collectAsStateWithLifecycle()
                ShareSheet(
                    state = state,
                    closeRequests = viewModel.close,
                    onOpenTeak = ::openTeak,
                    onClosed = ::finish,
                    details = ShareDetailsActions(
                        onAdd = viewModel::addDetails,
                        onTagInput = viewModel::updateTagInput,
                        onAddTag = viewModel::addTag,
                        onRemoveTag = viewModel::removeTag,
                        onNote = viewModel::updateNote,
                        onSave = viewModel::saveDetails,
                    ),
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        ShareIntents.processTextReply(intent)?.let { setResult(RESULT_OK, it) }
        viewModel.startAgain(ShareIntents.items(intent))
    }

    private fun openTeak() {
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }
}
