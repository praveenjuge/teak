package com.praveenjuge.teak.core.data

import kotlinx.coroutines.CancellationException
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class CatchingFailuresTest {
    @Test
    fun `a failure becomes a result`() {
        assertEquals(1, catchingFailures { 1 }.getOrThrow())
        assertIs<IOException>(catchingFailures { throw IOException("offline") }.exceptionOrNull())
    }

    @Test
    fun `cancellation and errors are never swallowed`() {
        assertFailsWith<CancellationException> { catchingFailures { throw CancellationException("left the screen") } }
        assertFailsWith<OutOfMemoryError> { catchingFailures { throw OutOfMemoryError() } }
    }
}
