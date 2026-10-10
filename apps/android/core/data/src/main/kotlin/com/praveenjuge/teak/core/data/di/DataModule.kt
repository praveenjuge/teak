package com.praveenjuge.teak.core.data.di

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.data.auth.Clock
import com.praveenjuge.teak.core.data.auth.ConvexUserBootstrap
import com.praveenjuge.teak.core.data.auth.DefaultWorkOsAuthApi
import com.praveenjuge.teak.core.data.auth.KeystoreSessionStore
import com.praveenjuge.teak.core.data.auth.SessionStore
import com.praveenjuge.teak.core.data.auth.UserBootstrap
import com.praveenjuge.teak.core.data.auth.WorkOsAuthApi
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.LiveConvexApi
import com.praveenjuge.teak.core.data.convex.WorkOsConvexAuthProvider
import com.praveenjuge.teak.core.data.prefs.DataStorePreferencesRepository
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.ConvexAccountRepository
import com.praveenjuge.teak.core.data.repository.ConvexCardsRepository
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.data.upload.WorkManagerUploadRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Qualifier
import javax.inject.Singleton

/** A scope that lives as long as the process, for work that must outlive any screen. */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class ApplicationScope

@Module
@InstallIn(SingletonComponent::class)
object DataProvidesModule {
    @Provides
    @Singleton
    @ApplicationScope
    fun applicationScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Provides
    @Singleton
    fun okHttpClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    @Provides
    fun clock(): Clock = Clock { System.currentTimeMillis() }

    @Provides
    @Named(DefaultWorkOsAuthApi.WORKOS_BASE_URL)
    fun workOsBaseUrl(): String = "https://api.workos.com"

    @Provides
    @Singleton
    fun convexClient(
        config: TeakConfig,
        authProvider: WorkOsConvexAuthProvider,
        @ApplicationScope scope: CoroutineScope,
    ): ConvexClientWithAuth<String> = ConvexClientWithAuth(config.convexUrl, authProvider, scope)

    @Provides
    @Singleton
    fun convexApi(client: ConvexClientWithAuth<String>): ConvexApi = LiveConvexApi(client)
}

@Module
@InstallIn(SingletonComponent::class)
abstract class DataBindsModule {
    @Binds abstract fun sessionStore(impl: KeystoreSessionStore): SessionStore
    @Binds abstract fun workOsAuthApi(impl: DefaultWorkOsAuthApi): WorkOsAuthApi
    @Binds abstract fun userBootstrap(impl: ConvexUserBootstrap): UserBootstrap
    @Binds abstract fun cardsRepository(impl: ConvexCardsRepository): CardsRepository
    @Binds abstract fun accountRepository(impl: ConvexAccountRepository): AccountRepository
    @Binds abstract fun preferencesRepository(impl: DataStorePreferencesRepository): PreferencesRepository
    @Binds abstract fun uploadRepository(impl: WorkManagerUploadRepository): UploadRepository
}
