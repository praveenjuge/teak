package com.praveenjuge.teak

import com.praveenjuge.teak.core.data.TeakConfig
import dagger.BindsOptionalOf
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.util.Optional

/**
 * The local E2E stack's endpoints and a signed-in test session. Only the Debug source set binds
 * one (`app/src/debug`); every other build leaves the Optional empty.
 */
interface E2ELaunch {
    val convexUrl: String?
    val workosUrl: String?

    /** Saves the test session before the app restores its own. */
    suspend fun adoptSession()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class E2ELaunchModule {
    @BindsOptionalOf
    abstract fun e2eLaunch(): E2ELaunch
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    fun teakConfig(e2e: Optional<E2ELaunch>): TeakConfig {
        val launch = e2e.orElse(null)
        return TeakConfig(
            convexUrl = launch?.convexUrl ?: BuildConfig.CONVEX_URL,
            versionName = BuildConfig.VERSION_NAME,
            isDebug = BuildConfig.DEBUG,
            workosBaseUrl = launch?.workosUrl ?: TeakConfig.HOSTED_WORKOS,
        )
    }
}
