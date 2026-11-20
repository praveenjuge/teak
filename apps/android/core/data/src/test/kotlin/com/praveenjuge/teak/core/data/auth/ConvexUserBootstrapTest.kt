package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.TeakConfig
import com.praveenjuge.teak.core.model.SIGNUPS_PAUSED_MESSAGE
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
    fun `opens the vault with one call that says where the signup came from`() = runTest {
        respond("""{"status":"ok","teakUserId":"teak_1"}""")
        bootstrap.ensureUser("token", "GoogleOAuth")
        val first = server.takeRequest()
        assertEquals("/api/mutation", first.path)
        assertEquals("Bearer token", first.getHeader("Authorization"))
        assertEquals(
            """{"path":"workosBootstrap:ensureUserWithSignup","args":{"platform":"android","authMethod":"GoogleOAuth"},"format":"json"}""",
            first.body.readUtf8(),
        )
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `falls back to ensureUser on a backend that predates the signup call`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status":"error","errorMessage":"[Request ID: 1] Server Error\nCould not find public function for 'workosBootstrap:ensureUserWithSignup'.\n"}""",
            ),
        )
        respond("""{"status":"ok","teakUserId":"teak_1"}""")
        bootstrap.ensureUser("token", "Password")
        server.takeRequest()
        assertEquals("""{"path":"workosBootstrap:ensureUser","args":{},"format":"json"}""", server.takeRequest().body.readUtf8())
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `any other server error fails the sign-in without falling back`() = runTest {
        server.enqueue(MockResponse().setBody("""{"status":"error","errorMessage":"Server Error\nUncaught Error: Boom"}"""))
        assertEquals(
            ConvexUserBootstrap.UNABLE_TO_OPEN_VAULT,
            assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message,
        )
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `explains unverified emails and frozen sign-ups`() = runTest {
        respond("""{"status":"verify_email"}""")
        assertEquals(
            "Verify your email before opening your vault.",
            assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message,
        )
        respond("""{"status":"frozen"}""")
        assertEquals(SIGNUPS_PAUSED_MESSAGE, assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message)
    }

    @Test
    fun `a quarantined account is a generic failure, not retried`() = runTest {
        respond("""{"status":"quarantined","reason":"external_id_mismatch"}""")
        assertEquals(
            ConvexUserBootstrap.UNABLE_TO_OPEN_VAULT,
            assertFailsWith<SignInException> { bootstrap.ensureUser("t") }.message,
        )
        assertEquals(1, server.requestCount)
    }
}
