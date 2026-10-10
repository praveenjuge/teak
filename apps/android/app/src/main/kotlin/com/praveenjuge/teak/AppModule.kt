package com.praveenjuge.teak

import com.praveenjuge.teak.core.data.TeakConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    fun teakConfig(): TeakConfig = TeakConfig(
        convexUrl = BuildConfig.CONVEX_URL,
        versionName = BuildConfig.VERSION_NAME,
        isDebug = BuildConfig.DEBUG,
    )
}
