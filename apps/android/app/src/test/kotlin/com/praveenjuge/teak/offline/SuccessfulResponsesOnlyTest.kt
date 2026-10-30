package com.praveenjuge.teak.offline

import coil3.network.CacheStrategy
import coil3.network.NetworkRequest
import coil3.network.NetworkResponse
import coil3.request.Options
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = android.app.Application::class)
class SuccessfulResponsesOnlyTest {
    private val request = NetworkRequest("https://files.teakvault.com/__images/v1/compact/a.webp")
    private val options = Options(RuntimeEnvironment.getApplication())

    @Test
    fun `a missing image is never stored, so a later signature fetches it again`() = runTest {
        for (code in listOf(404, 410, 301)) {
            assertEquals(
                CacheStrategy.WriteResult.DISABLED,
                SuccessfulResponsesOnly.write(null, request, NetworkResponse(code = code), options),
                "HTTP $code",
            )
        }
    }

    @Test
    fun `an image that loaded is stored`() = runTest {
        assertNotEquals(
            CacheStrategy.WriteResult.DISABLED,
            SuccessfulResponsesOnly.write(null, request, NetworkResponse(code = 200), options),
        )
    }
}
