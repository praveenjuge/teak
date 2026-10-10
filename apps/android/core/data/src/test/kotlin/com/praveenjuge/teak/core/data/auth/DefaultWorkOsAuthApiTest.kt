package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.Tokens
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DefaultWorkOsAuthApiTest {
    private val server = MockWebServer().apply { start() }
    private val api = DefaultWorkOsAuthApi(OkHttpClient(), server.url("/").toString())

    @After fun tearDown() = server.shutdown()

    private fun okResponse() = MockResponse().setBody(
        """{"access_token":"${Tokens.jwt("client_1", "user_1", "session_1", 2_000)}","refresh_token":"r2",
           "user":{"id":"user_1","email":"a@b.c","email_verified":true}}""",
    )

    @Test
    fun `exchanges the code as a public client, without a client secret`() = runTest {
        server.enqueue(okResponse())
        val session = api.exchangeCode(PendingSignIn("client_1", "verifier-123", "state"), "code-1")
        assertEquals("r2", session.refreshToken)
        val body = server.takeRequest().body.readUtf8()
        assertEquals(
            """{"client_id":"client_1","grant_type":"authorization_code","code":"code-1","code_verifier":"verifier-123"}""",
            body,
        )
    }

    @Test
    fun `refreshes without a client secret`() = runTest {
        server.enqueue(okResponse())
        api.refresh("client_1", "r1")
        assertEquals(
            """{"client_id":"client_1","grant_type":"refresh_token","refresh_token":"r1"}""",
            server.takeRequest().body.readUtf8(),
        )
    }

    @Test
    fun `an invalid grant ends the session while a server error keeps it`() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"invalid_grant"}"""))
        assertFailsWith<InvalidRefreshTokenException> { api.refresh("client_1", "r1") }
        server.enqueue(MockResponse().setResponseCode(502))
        assertFailsWith<IOException> { api.refresh("client_1", "r1") }
    }

    @Test
    fun `the authorize URL carries the provider, screen hint, PKCE and redirect`() {
        val (url, pending) = api.startSignIn("client_1", SignInMethod.EmailSignUp)
        assertTrue("provider=authkit" in url, url)
        assertTrue("screen_hint=sign-up" in url, url)
        assertTrue("code_challenge_method=S256" in url, url)
        assertTrue("redirect_uri=teak%3A%2F%2Fauth%2Fcallback" in url, url)
        assertTrue("state=${pending.state}" in url, url)
    }
}
