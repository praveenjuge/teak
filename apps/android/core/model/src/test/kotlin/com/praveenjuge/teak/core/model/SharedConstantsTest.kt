package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class SharedConstantsTest {
    @Test
    fun `card types match the backend's`() {
        assertEquals(CARD_TYPES, CardType.entries.map { it.wireName })
    }

    @Test
    fun `color hues match the backend's buckets`() {
        assertEquals(COLOR_HUE_BUCKETS, ColorHue.entries.map { it.wireName })
    }
}
