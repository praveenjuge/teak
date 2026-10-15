package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HexColorTest {
    @Test
    fun `reads short, full and CSS-ordered alpha hex colors as ARGB`() {
        assertEquals(0xFFAABBCC, parseHexArgb("#abc"))
        assertEquals(0xFF112233, parseHexArgb(" #112233 "))
        assertEquals(0x80112233, parseHexArgb("11223380"))
    }

    @Test
    fun `anything else is not a color`() {
        assertNull(parseHexArgb("#12345"))
        assertNull(parseHexArgb("#zzzzzz"))
        assertNull(parseHexArgb(""))
    }
}
