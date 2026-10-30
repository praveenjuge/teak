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
import kotlinx.coroutines.async
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

    private suspend fun TestScope.copies(userId: String = "user_1"): DiskOfflineCopies {
        store.session = Tokens.session(userId = userId, expiresAtMillis = Long.MAX_VALUE / 2)
        val sessions = SessionManager(store, NoAuthApi, NoBootstrap, backgroundScope, Clock { 0 }).apply { restore() }
        return DiskOfflineCopies(context, OkHttpClient(), sessions, backgroundScope)
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
        java.io.File(context.filesDir, "offline").deleteRecursively()
        val copies = copies()
        copies.keep(pdf("/files/a.pdf", signature = "one"))

        copies.update(pdf("/files/a.pdf", signature = "two").copy(metadataTitle = "Renamed"))
        assertNotNull(copies.file("c1"))
        assertEquals("Renamed", copies.card("c1")?.metadataTitle)

        copies.update(pdf("/files/b.pdf", signature = "three"))
        assertNull(copies.file("c1"))
        assertNotNull(copies.card("c1"))
    }

    @Test
    fun `cards another account kept go when a different account signs in`() = runTest {
        val root = java.io.File(context.filesDir, "offline").apply { deleteRecursively() }
        java.io.File(root, "c9").mkdirs()
        java.io.File(root, "c9/card.json").writeText("""{"_id":"c9","_creationTime":0,"type":"text"}""")
        java.io.File(root, "owner").writeText("user_a")

        copies(userId = "user_b")

        repeat(100) {
            testScheduler.advanceUntilIdle()
            if (!java.io.File(root, "c9").exists()) return@runTest
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Thread.sleep(20) }
        }
        kotlin.test.fail("user_a's kept card is still there")
    }

    @Test
    fun `a card whose copies were cleared mid-download isn't kept, and clearing doesn't wait for it`() = runTest {
        java.io.File(context.filesDir, "offline").deleteRecursively()
        server.enqueue(MockResponse().setBody("%PDF-1.7").setBodyDelay(1, java.util.concurrent.TimeUnit.SECONDS))
        val copies = copies()

        val keeping = async { runCatching { copies.keep(pdf("/files/slow.pdf", signature = "one")) } }
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { server.takeRequest() }
        copies.clear()

        kotlin.test.assertTrue(keeping.await().exceptionOrNull() is java.io.IOException)
        kotlin.test.assertTrue(copies.kept.value.isEmpty())
        assertNull(copies.card("c1"))
    }
}
