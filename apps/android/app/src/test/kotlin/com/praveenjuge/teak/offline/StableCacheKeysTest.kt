package com.praveenjuge.teak.offline

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class StableCacheKeysTest {
    @Test
    fun `a signed card image keeps one cache key across new signatures`() {
        val morning = "https://files.teakvault.com/img/compact/users%2Fu1%2Fa.webp?exp=1793300000&sig=abc"
        val evening = "https://files.teakvault.com/img/compact/users%2Fu1%2Fa.webp?exp=1793321600&sig=def"

        assertEquals("https://files.teakvault.com/img/compact/users%2Fu1%2Fa.webp", stableCacheKey(morning))
        assertEquals(stableCacheKey(morning), stableCacheKey(evening))
    }

    @Test
    fun `other links keep Coil's own key`() {
        assertNull(stableCacheKey("https://example.com/preview.png?w=200"))
        assertNull(stableCacheKey("https://example.com/preview.png?exp=1"))
        assertNull(stableCacheKey("file:///data/user/0/offline/c1/file"))
    }
}
