package com.praveenjuge.teak.feature.capture

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StopwatchTest {
    private var now = 1_000L
    private val stopwatch = Stopwatch { now }

    @Test
    fun `time spent paused does not count`() {
        stopwatch.start()
        now += 3_000
        stopwatch.pause()
        assertFalse(stopwatch.isRunning)
        now += 60_000
        assertEquals(3_000, stopwatch.elapsedMillis)

        stopwatch.start()
        now += 2_000
        assertTrue(stopwatch.isRunning)
        assertEquals(5_000, stopwatch.elapsedMillis)
    }

    @Test
    fun `reset starts over from zero`() {
        stopwatch.start()
        now += 3_000
        stopwatch.reset()
        assertFalse(stopwatch.isRunning)
        assertEquals(0, stopwatch.elapsedMillis)
    }
}
