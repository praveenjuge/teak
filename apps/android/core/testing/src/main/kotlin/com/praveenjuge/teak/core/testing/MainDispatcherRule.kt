package com.praveenjuge.teak.core.testing

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.rules.TestWatcher
import org.junit.runner.Description

/** Runs `viewModelScope` on a test dispatcher. */
class MainDispatcherRule(val dispatcher: TestDispatcher = UnconfinedTestDispatcher()) : TestWatcher() {
    override fun starting(description: Description) = Dispatchers.setMain(dispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}
