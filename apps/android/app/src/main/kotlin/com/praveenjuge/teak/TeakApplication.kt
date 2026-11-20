package com.praveenjuge.teak

import android.app.Application
import android.content.Intent
import android.os.Build
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
import com.praveenjuge.teak.core.data.Analytics
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.LanguageRepository
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.offline.StableCacheKeys
import com.praveenjuge.teak.offline.SuccessfulResponsesOnly
import com.praveenjuge.teak.offline.TilePrefetchWorker
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.util.Optional
import javax.inject.Inject

@HiltAndroidApp
class TeakApplication : Application(), Configuration.Provider, SingletonImageLoader.Factory {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var account: AccountRepository
    @Inject lateinit var httpClient: OkHttpClient
    @Inject @ApplicationScope lateinit var scope: CoroutineScope
    @Inject lateinit var e2eLaunch: Optional<E2ELaunch>
    @Inject lateinit var language: LanguageRepository
    @Inject lateinit var uploads: UploadRepository

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        initPostHog()
        publishShortcuts()
        // Android 12 sends no configuration change for an in-app language, so relabel on each change.
        scope.launch { language.current.drop(1).collect { publishShortcuts() } }
        scope.launch {
            e2eLaunch.orElse(null)?.let { launch -> catchingFailures { launch.adoptSession() } }
            account.start()
        }
        scope.launch { catchingFailures { uploads.sweepAbandoned() } }
        TilePrefetchWorker.schedule(this)
    }

    /** A new app language relabels the launcher shortcuts. */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        publishShortcuts()
    }

    private fun publishShortcuts() {
        val labels = AppLanguage.resources(this)
        fun shortcut(id: String, label: String, icon: Int, action: String) =
            ShortcutInfoCompat.Builder(this, id)
                .setShortLabel(label)
                .setIcon(IconCompat.createWithResource(this, icon))
                .setIntent(Intent(this, MainActivity::class.java).setAction(action))
                .build()
        ShortcutManagerCompat.setDynamicShortcuts(
            this,
            listOf(
                shortcut("new_note", labels.tr("native.capture.newNote"), R.drawable.ic_shortcut_note, MainActivity.ACTION_NEW_NOTE),
                shortcut("voice_memo", labels.tr("native.capture.voiceMemo"), R.drawable.ic_shortcut_mic, MainActivity.ACTION_VOICE_MEMO),
            ),
        )
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(StableCacheKeys)
                add(
                    OkHttpNetworkFetcherFactory(
                        callFactory = { httpClient.newBuilder().followRedirects(true).build() },
                        cacheStrategy = { SuccessfulResponsesOnly },
                    ),
                )
                add(AnimatedImageDecoder.Factory())
                add(VideoFrameDecoder.Factory())
            }
            .apply { if (BuildConfig.DEBUG) logger(DebugLogger()) }
            .build()

    private fun initPostHog() {
        val token = BuildConfig.POSTHOG_TOKEN
        if (token.isBlank()) return
        // Play's pre-launch test device runs each release on an Android older than minSdk, where R8 has dropped
        // every API check (SplashScreenView, Configuration.fontWeightAdjustment). Its crashes aren't ones a person
        // can hit, since Play won't install Teak there, so it reports nothing. The check compares with
        // applicationInfo, not a constant, so R8 can't drop it too.
        if (Build.VERSION.SDK_INT < applicationInfo.minSdkVersion) return
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
        Analytics.recorder = { event, properties -> PostHog.capture(event, properties = properties) }
        scope.launch {
            account.session
                .filter { it != SessionState.Loading }
                .map { (it as? SessionState.SignedIn)?.user?.id }
                .distinctUntilChanged()
                .collectLatest { workosUserId -> identify(workosUserId) }
        }
    }

    private var signedInAs: String? = null

    /**
     * Identifies analytics with the Teak user id Convex resolves for the session, as the web app
     * does. The session's `teakUserId` is WorkOS's `external_id`, which accounts created since the
     * move to WorkOS don't have.
     */
    private suspend fun identify(workosUserId: String?) {
        if (signedInAs != null) PostHog.reset()
        signedInAs = workosUserId
        if (workosUserId == null) return
        val user = account.currentUser.mapNotNull { it.getOrNull() }.firstOrNull() ?: return
        PostHog.identify(user.id, userProperties = mapOf("email" to user.email))
    }
}
