package com.praveenjuge.teak.core.data.repository

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.praveenjuge.teak.core.data.ClosedChannelClient
import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.FakeOfflineCopies
import com.praveenjuge.teak.core.data.FakeOutbox
import com.praveenjuge.teak.core.data.InMemorySessionStore
import com.praveenjuge.teak.core.data.Tokens
import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.Clock
import com.praveenjuge.teak.core.data.auth.PendingSignIn
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.auth.UserBootstrap
import com.praveenjuge.teak.core.data.auth.WorkOsAuthApi
import com.praveenjuge.teak.core.data.convex.WorkOsConvexAuthProvider
import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.data.upload.StageResult
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.data.upload.UploadStatus
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ConvexAccountRepositoryTest {
    @Test
    fun `signing out clears the session even when queued uploads can't be discarded`() = runTest {
        val steps = mutableListOf<String>()

        signOutLocally(
            discardQueued = {
                steps += "discard"
                throw IOException("database or disk is full")
            },
            clearSession = { steps += "clear" },
        )

        assertEquals(listOf("discard", "clear"), steps)
    }

    @Test
    fun `signing out finishes after the screen that started it is gone`() = runTest {
        val discarding = CompletableDeferred<Unit>()
        var cleared = false
        val screen = launch {
            signOutLocally(discardQueued = { discarding.await() }, clearSession = { cleared = true })
        }
        advanceUntilIdle()

        screen.cancel()
        discarding.complete(Unit)
        advanceUntilIdle()

        assertTrue(cleared)
    }

    @Test
    fun `a native client whose connection has shut down neither crashes launch nor stops signing out`() = runTest {
        val now = 1_000_000_000L
        val store = InMemorySessionStore().apply { session = Tokens.session(expiresAtMillis = now + 3_600_000) }
        val sessions = SessionManager(store, NoAuthApi, NoBootstrap, backgroundScope, Clock { now })
        val client = ConvexClientWithAuth(
            deploymentUrl = "https://test.convex.cloud",
            authProvider = WorkOsConvexAuthProvider(sessions, backgroundScope),
            coroutineScope = backgroundScope,
        ) { _, _, _ -> ClosedChannelClient }
        val account = ConvexAccountRepository(
            ApplicationProvider.getApplicationContext<Context>(),
            sessions,
            FakeConvexApi(),
            client,
            NoPreferences,
            NoUploads,
            FakeOutbox(),
            FakeOfflineCopies(),
            backgroundScope,
        )

        account.start()
        assertIs<SessionState.SignedIn>(account.session.value)

        account.signOut()
        assertEquals(SessionState.SignedOut, account.session.value)
        assertEquals(null, store.session)
    }

    private object NoAuthApi : WorkOsAuthApi {
        override fun startSignIn(clientId: String, method: SignInMethod) = error("unused")
        override suspend fun exchangeCode(pending: PendingSignIn, code: String): AuthSession = error("unused")
        override suspend fun refresh(clientId: String, refreshToken: String): AuthSession = error("unused")
    }

    private object NoBootstrap : UserBootstrap {
        override suspend fun ensureUser(accessToken: String) = Unit
    }

    private object NoPreferences : PreferencesRepository {
        override val theme: Flow<ThemePreference> = emptyFlow()
        override suspend fun setTheme(theme: ThemePreference) = Unit
        override val useWallpaperColors: Flow<Boolean> = emptyFlow()
        override suspend fun setUseWallpaperColors(enabled: Boolean) = Unit
        override suspend fun cachedAuthMode(): String? = null
        override suspend fun cacheAuthMode(json: String) = Unit
    }

    private object NoUploads : UploadRepository {
        override suspend fun stage(uris: List<Uri>, metadata: (Uri) -> Map<String, Double>): StageResult = error("unused")
        override fun enqueue(files: List<StagedFile>) = Unit
        override val uploads: Flow<List<UploadStatus>> = emptyFlow()
        override fun clearFinished() = Unit
        override suspend fun discardAll() = Unit
        override suspend fun sweepAbandoned() = Unit
    }
}
