package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.UiText
import dev.convex.android.AuthTokenProvider
import dev.convex.android.ClientException
import dev.convex.android.ConvexClient
import dev.convex.android.MobileConvexClientInterface
import dev.convex.android.QuerySubscriber
import dev.convex.android.SubscriptionHandle
import dev.convex.android.WebSocketState
import dev.convex.android.WebSocketStateSubscriber
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

/** The native client fails with "channel closed" once its connection has shut down. */
class LiveConvexApiTest {
    private val api = LiveConvexApi(
        ConvexClient("https://test.convex.cloud") { _, _, socket ->
            socket?.onStateChange(WebSocketState.CONNECTED)
            ClosedChannelClient
        },
    )

    @Test
    fun `a subscription the native client can't start fails instead of crashing its collector`() = runTest {
        val results = api.subscribe("auth:getAuthMode").toList()

        val failure = assertIs<TeakException>(results.single().exceptionOrNull())
        assertEquals(UiText.of("native.errors.generic"), failure.text)
    }

    @Test
    fun `a mutation or action the native client can't send fails with the generic words`() = runTest {
        for (call in listOf<suspend () -> Unit>({ api.mutation("cards:createCard") }, { api.action("cards:search") })) {
            val failure = assertFailsWith<TeakException> { call() }
            assertEquals(UiText.of("native.errors.generic"), failure.text)
        }
    }

    private object ClosedChannelClient : MobileConvexClientInterface {
        private fun closed(): Nothing = throw ClientException.InternalException("channel closed")

        override suspend fun action(name: String, args: Map<String, String>): String = closed()
        override suspend fun mutation(name: String, args: Map<String, String>): String = closed()
        override suspend fun query(name: String, args: Map<String, String>): String = closed()
        override suspend fun setAuth(token: String?) = closed()
        override suspend fun setAuthCallback(provider: AuthTokenProvider?) = closed()
        override suspend fun subscribe(name: String, args: Map<String, String>, subscriber: QuerySubscriber): SubscriptionHandle =
            closed()
    }

    @Test
    fun `offline, a mutation fails at once instead of waiting for a reconnect`() = runTest {
        val offline = LiveConvexApi(ConvexClient("https://test.convex.cloud") { _, _, _ -> HangingClient })

        val failure = assertFailsWith<TeakException> { offline.mutation("cards:updateCardField") }

        assertEquals(TeakException.OFFLINE, failure.code)
    }

    @Test
    fun `a mutation whose connection drops fails as offline`() = runTest {
        lateinit var socket: WebSocketStateSubscriber
        val dropping = LiveConvexApi(
            ConvexClient("https://test.convex.cloud") { _, _, subscriber ->
                socket = subscriber!!
                subscriber?.onStateChange(WebSocketState.CONNECTED)
                HangingClient
            },
        )
        val call = async { runCatching { dropping.mutation("cards:updateCardField") } }
        runCurrent()

        socket.onStateChange(WebSocketState.CONNECTING)

        assertEquals(TeakException.OFFLINE, (call.await().exceptionOrNull() as TeakException).code)
    }

    /** A client whose calls never answer, as the native one holds a call made on a dead socket. */
    private object HangingClient : MobileConvexClientInterface {
        override suspend fun action(name: String, args: Map<String, String>): String = awaitCancellation()
        override suspend fun mutation(name: String, args: Map<String, String>): String = awaitCancellation()
        override suspend fun query(name: String, args: Map<String, String>): String = awaitCancellation()
        override suspend fun setAuth(token: String?) = Unit
        override suspend fun setAuthCallback(provider: AuthTokenProvider?) = Unit
        override suspend fun subscribe(name: String, args: Map<String, String>, subscriber: QuerySubscriber): SubscriptionHandle =
            awaitCancellation()
    }
}
