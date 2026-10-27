package com.praveenjuge.teak.core.data.repository

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConvexAccountRepositoryTest {
    @Test
    fun `signing out clears the session even when queued uploads can't be discarded`() = runTest {
        val steps = mutableListOf<String>()

        signOutLocally(
            discardUploads = {
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
            signOutLocally(discardUploads = { discarding.await() }, clearSession = { cleared = true })
        }
        advanceUntilIdle()

        screen.cancel()
        discarding.complete(Unit)
        advanceUntilIdle()

        assertTrue(cleared)
    }
}
