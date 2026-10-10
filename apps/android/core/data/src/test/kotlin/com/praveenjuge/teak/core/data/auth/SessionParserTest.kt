package com.praveenjuge.teak.core.data.auth

import com.praveenjuge.teak.core.data.Tokens
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SessionParserTest {
    private fun body(token: String, externalId: String? = "teak_1") = """
        {"access_token":"$token","refresh_token":"r1",
         "user":{"id":"user_1","email":"ada@example.com","email_verified":true,
                 "first_name":"Ada","last_name":"Lovelace","external_id":${externalId?.let { "\"$it\"" } ?: "null"}}}
    """.trimIndent()

    @Test
    fun `reads the session, user and expiry from an authenticate response`() {
        val session = SessionParser.parseResponse("client_1", body(Tokens.jwt("client_1", "user_1", "session_9", 2_000)))
        assertEquals("session_9", session.sessionId)
        assertEquals(2_000_000L, session.expiresAtMillis)
        assertEquals("Ada Lovelace", session.user.name)
        assertEquals("teak_1", session.user.teakUserId)
    }

    @Test
    fun `rejects tokens issued for another client or user`() {
        assertFailsWith<SignInException> {
            SessionParser.parseResponse("client_1", body(Tokens.jwt("client_2", "user_1", "session_1", 2_000)))
        }
        assertFailsWith<SignInException> {
            SessionParser.parseResponse("client_1", body(Tokens.jwt("client_1", "user_2", "session_1", 2_000)))
        }
        assertFailsWith<SignInException> {
            SessionParser.parseResponse("client_1", body(Tokens.jwt("client_1", "user_1", "nope", 2_000)))
        }
        assertFailsWith<SignInException> { SessionParser.parseResponse("client_1", "not json") }
    }
}
