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
import com.praveenjuge.teak.core.data.offline.DiskOfflineCopies
import com.praveenjuge.teak.core.data.offline.FileOutbox
import com.praveenjuge.teak.core.data.offline.OfflineCopies
import com.praveenjuge.teak.core.data.offline.Outbox
import com.praveenjuge.teak.core.data.prefs.DataStorePreferencesRepository
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.repository.ConvexAccountRepository
import com.praveenjuge.teak.core.data.repository.ConvexLanguageRepository
import com.praveenjuge.teak.core.data.repository.ConvexCardsRepository
import com.praveenjuge.teak.core.data.repository.ConvexFoldersRepository
import com.praveenjuge.teak.core.data.repository.ConvexTagsRepository
import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.data.repository.LanguageRepository
import com.praveenjuge.teak.core.data.repository.TagsRepository
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
    fun workOsBaseUrl(config: TeakConfig): String = config.workosBaseUrl

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
    @Binds abstract fun foldersRepository(impl: ConvexFoldersRepository): FoldersRepository
    @Binds abstract fun tagsRepository(impl: ConvexTagsRepository): TagsRepository
    @Binds abstract fun accountRepository(impl: ConvexAccountRepository): AccountRepository
    @Binds abstract fun languageRepository(impl: ConvexLanguageRepository): LanguageRepository
    @Binds abstract fun preferencesRepository(impl: DataStorePreferencesRepository): PreferencesRepository
    @Binds abstract fun uploadRepository(impl: WorkManagerUploadRepository): UploadRepository
    @Binds abstract fun outbox(impl: FileOutbox): Outbox
    @Binds abstract fun offlineCopies(impl: DiskOfflineCopies): OfflineCopies
}
