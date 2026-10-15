package com.praveenjuge.teak.feature.capture

import android.os.SystemClock

internal class Stopwatch(private val now: () -> Long = SystemClock::elapsedRealtime) {
    private var bankedMillis = 0L
    private var runningSince: Long? = null

    val isRunning: Boolean get() = runningSince != null

    val elapsedMillis: Long get() = bankedMillis + (runningSince?.let { now() - it } ?: 0L)

    fun start() {
        if (runningSince == null) runningSince = now()
    }

    fun pause() {
        bankedMillis = elapsedMillis
        runningSince = null
    }

    fun reset() {
        bankedMillis = 0
        runningSince = null
    }
}
