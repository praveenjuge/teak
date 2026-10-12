package com.praveenjuge.teak

import android.app.Application
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.gif.AnimatedImageDecoder
import coil3.util.DebugLogger
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.video.VideoFrameDecoder
import com.posthog.PersonProfiles
import com.posthog.PostHog
import com.posthog.android.PostHogAndroid
import com.posthog.android.PostHogAndroidConfig
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SessionUser
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.repository.AccountRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import javax.inject.Inject

@HiltAndroidApp
class TeakApplication : Application(), Configuration.Provider, SingletonImageLoader.Factory {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var account: AccountRepository
    @Inject lateinit var httpClient: OkHttpClient
    @Inject @ApplicationScope lateinit var scope: CoroutineScope

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        initPostHog()
        publishShortcuts()
        scope.launch { account.start() }
    }

    /** "New note" and "Voice memo" on the launcher icon's long-press menu. */
    private fun publishShortcuts() {
        fun shortcut(id: String, label: Int, icon: Int, action: String) =
            ShortcutInfoCompat.Builder(this, id)
                .setShortLabel(getString(label))
                .setIcon(IconCompat.createWithResource(this, icon))
                .setIntent(Intent(this, MainActivity::class.java).setAction(action))
                .build()
        ShortcutManagerCompat.setDynamicShortcuts(
            this,
            listOf(
                shortcut("new_note", R.string.shortcut_new_note, R.drawable.ic_shortcut_note, MainActivity.ACTION_NEW_NOTE),
                shortcut("voice_memo", R.string.shortcut_voice_memo, R.drawable.ic_shortcut_mic, MainActivity.ACTION_VOICE_MEMO),
            ),
        )
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { httpClient.newBuilder().followRedirects(true).build() }))
                add(AnimatedImageDecoder.Factory())
                add(VideoFrameDecoder.Factory())
            }
            .apply { if (BuildConfig.DEBUG) logger(DebugLogger()) }
            .build()

    /** Product analytics and crash reporting, matching the iPhone app. Off when the build has no token. */
    private fun initPostHog() {
        val token = BuildConfig.POSTHOG_TOKEN
        if (token.isBlank()) return
        val config = PostHogAndroidConfig(
            projectToken = token,
            host = "https://us.i.posthog.com",
            captureApplicationLifecycleEvents = true,
            captureDeepLinks = false,
            captureScreenViews = false,
        ).apply {
            sessionReplay = false
            preloadFeatureFlags = false
            personProfiles = PersonProfiles.IDENTIFIED_ONLY
            flushAt = 20
            flushIntervalSeconds = 30
            errorTrackingConfig.autoCapture = true
        }
        PostHogAndroid.setup(this, config)
        scope.launch { account.session.collect { identify(it) } }
    }

    private var identified: SessionUser? = null

    /** Ties events to the permanent vault ID, with the email as a person property; resets on sign-out. */
    private fun identify(state: SessionState) {
        val user = when (state) {
            SessionState.Loading -> return
            SessionState.SignedOut -> null
            is SessionState.SignedIn -> state.user
        }
        val previous = identified
        identified = user
        val teakUserId = user?.teakUserId
        if (previous?.teakUserId != null && previous.teakUserId != teakUserId) PostHog.reset()
        if (user != null && teakUserId != null && (teakUserId != previous?.teakUserId || user.email != previous.email)) {
            PostHog.identify(teakUserId, userProperties = mapOf("email" to user.email))
        }
    }
}
