package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.model.TeakMessages
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ConvexUserBootstrapTest {
    private val server = MockWebServer().apply { start() }
    private val bootstrap = ConvexUserBootstrap(OkHttpClient(), TeakConfig(server.url("/").toString(), "1.0.0", true))

    @After fun tearDown() = server.shutdown()

    private fun respond(value: String) =
        server.enqueue(MockResponse().setBody("""{"status":"success","value":$value}"""))

    @Test
    fun `waits for a new account's profile, then succeeds`() = runTest {
        respond("""{"status":"quarantined","reason":"profile_pending"}""")
        respond("""{"status":"ok","teakUserId":"teak_1"}""")
        bootstrap.ensureUser("token")
        val first = server.takeRequest()
        assertEquals("/api/mutation", first.path)
        assertEquals("Bearer token", first.getHeader("Authorization"))
        assertEquals("""{"path":"workosBootstrap:ensureUser","args":{},"format":"json"}""", first.body.readUtf8())
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `explains unverified emails and frozen sign-ups`() = runTest {
        respond("""{"status":"verify_email"}""")
        assertEquals(
            "Verify your email before opening your vault.",
            assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message,
        )
        respond("""{"status":"frozen"}""")
        assertEquals(TeakMessages.SIGNUPS_PAUSED, assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message)
    }

    @Test
    fun `any other quarantine is a generic failure`() = runTest {
        respond("""{"status":"quarantined","reason":"external_id_mismatch"}""")
        assertEquals(
            ConvexUserBootstrap.UNABLE_TO_OPEN_VAULT,
            assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message,
        )
    }
}
