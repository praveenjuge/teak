package com.praveenjuge.teak.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Records the classes and methods Teak runs at launch, so ART compiles them ahead of time.
 * Run with `./gradlew :app:generateReleaseBaselineProfile` on a connected device or emulator.
 */
@RunWith(AndroidJUnit4::class)
class StartupProfileGenerator {
    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun startup() = rule.collect(packageName = "com.praveenjuge.teak", includeInStartupProfile = true) {
        pressHome()
        startActivityAndWait()
        device.waitForIdle()
    }
}
