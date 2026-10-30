package com.praveenjuge.teak.core.data.offline

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.InMemorySessionStore
import com.praveenjuge.teak.core.data.Tokens
import com.praveenjuge.teak.core.data.auth.AuthSession
import com.praveenjuge.teak.core.data.auth.Clock
import com.praveenjuge.teak.core.data.auth.PendingSignIn
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.data.auth.UserBootstrap
import com.praveenjuge.teak.core.data.auth.WorkOsAuthApi
import com.praveenjuge.teak.core.data.convex.teakJson
import com.praveenjuge.teak.core.model.CardFieldChange
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class FileOutboxTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val store = InMemorySessionStore()
    private val now = 1_000_000_000L

    private object NoAuthApi : WorkOsAuthApi {
        override fun startSignIn(clientId: String, method: SignInMethod) = error("unused")
        override suspend fun exchangeCode(pending: PendingSignIn, code: String): AuthSession = error("unused")
        override suspend fun refresh(clientId: String, refreshToken: String): AuthSession = error("unused")
    }

    private object NoBootstrap : UserBootstrap {
        override suspend fun ensureUser(accessToken: String) = Unit
    }

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        File(context.noBackupFilesDir, "outbox.json").delete()
    }

    private suspend fun TestScope.signedInAs(userId: String): SessionManager {
        store.session = Tokens.session(userId = userId, expiresAtMillis = now + 3_600_000)
        return SessionManager(store, NoAuthApi, NoBootstrap, backgroundScope, Clock { now }).apply { restore() }
    }

    private fun saved(vararg items: OutboxItem) =
        File(context.noBackupFilesDir, "outbox.json")
            .writeText(teakJson.encodeToString(ListSerializer(OutboxItem.serializer()), items.toList()))

    @Test
    fun `a write is tagged with the account that made it`() = runTest {
        val outbox = FileOutbox(context, FakeConvexApi(), signedInAs("user_a"), backgroundScope)

        outbox.add(listOf(OutboxItem.CreateText("t1", "Written offline")))

        assertEquals("user_a", outbox.next()?.ownerId)
    }

    @Test
    fun `another account's waiting writes go when someone else signs in`() = runTest {
        saved(
            OutboxItem.CreateText("t1", "From A", ownerId = "user_a"),
            OutboxItem.Edit("e1", "c1", CardFieldChange.Favorite(true), ownerId = "user_b"),
        )

        val outbox = FileOutbox(context, FakeConvexApi(), signedInAs("user_b"), backgroundScope)
        outbox.next()

        assertEquals(listOf("e1"), outbox.items.first { items -> items.none { it.ownerId == "user_a" } }.map { it.id })
    }

    @Test
    fun `a write with no one signed in is refused instead of dropped later`() = runTest {
        store.session = null
        val sessions = SessionManager(store, NoAuthApi, NoBootstrap, backgroundScope, Clock { now }).apply { restore() }
        val outbox = FileOutbox(context, FakeConvexApi(), sessions, backgroundScope)

        kotlin.test.assertFailsWith<IllegalStateException> { outbox.add(listOf(OutboxItem.CreateText("t1", "Lost"))) }
        assertEquals(null, outbox.next())
    }
}
