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
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.video.VideoFrameDecoder
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.repository.AccountRepository
import dagger.hilt.android.HiltAndroidApp
import io.sentry.android.core.SentryAndroid
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
        initSentry()
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
            .build()

    private fun initSentry() {
        val dsn = BuildConfig.SENTRY_DSN
        if (dsn.isBlank()) return
        SentryAndroid.init(this) { options ->
            options.dsn = dsn
            options.environment = if (BuildConfig.DEBUG) "development" else "production"
            options.release = "teak-android@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            options.isSendDefaultPii = false
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.tracesSampleRate = if (BuildConfig.DEBUG) 1.0 else 0.1
            options.setTag("surface", "android")
            options.setTag("app", "teak")
        }
    }
}
