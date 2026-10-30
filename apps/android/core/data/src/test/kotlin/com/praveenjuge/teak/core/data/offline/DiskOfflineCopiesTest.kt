package com.praveenjuge.teak.core.data.offline

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.praveenjuge.teak.core.data.InMemorySessionStore
import com.praveenjuge.teak.core.data.Tokens
import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.Clock
import com.praveenjuge.teak.core.data.auth.PendingSignIn
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.auth.UserBootstrap
import com.praveenjuge.teak.core.data.auth.WorkOsAuthApi
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardType
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DiskOfflineCopiesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer().apply { start() }
    private val store = InMemorySessionStore()

    private object NoAuthApi : WorkOsAuthApi {
        override fun startSignIn(clientId: String, method: SignInMethod) = error("unused")
        override suspend fun exchangeCode(pending: PendingSignIn, code: String): AuthSession = error("unused")
        override suspend fun refresh(clientId: String, refreshToken: String): AuthSession = error("unused")
    }

    private object NoBootstrap : UserBootstrap {
        override suspend fun ensureUser(accessToken: String) = Unit
    }

    @After
    fun tearDown() = server.shutdown()

    private suspend fun TestScope.copies(): DiskOfflineCopies {
        store.session = Tokens.session(expiresAtMillis = Long.MAX_VALUE / 2)
        val sessions = SessionManager(store, NoAuthApi, NoBootstrap, backgroundScope, Clock { 0 }).apply { restore() }
        return DiskOfflineCopies(context, OkHttpClient(), sessions, backgroundScope).apply { clear() }
    }

    private fun pdf(path: String, signature: String) = Card(
        id = "c1",
        creationTime = 0.0,
        type = CardType.Document,
        fileUrl = server.url(path).newBuilder().addQueryParameter("exp", "1").addQueryParameter("sig", signature).build().toString(),
    )

    @Test
    fun `a kept file stays across new signatures and goes when the server's file changes`() = runTest {
        server.enqueue(MockResponse().setBody("%PDF-1.7"))
        val copies = copies()
        copies.keep(pdf("/files/a.pdf", signature = "one"))

        copies.update(pdf("/files/a.pdf", signature = "two").copy(metadataTitle = "Renamed"))
        assertNotNull(copies.file("c1"))
        assertEquals("Renamed", copies.card("c1")?.metadataTitle)

        copies.update(pdf("/files/b.pdf", signature = "three"))
        assertNull(copies.file("c1"))
        assertNotNull(copies.card("c1"))
    }
}
