package com.praveenjuge.teak.core.model

import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlin.test.assertEquals

class SaveLinkTest {
    @Test
    fun `keeps characters a router would cut off`() {
        val text = "# Trip plan\n\n- Salt & pepper = 100% #food + more?"
        val encoded = URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20")
        assertEquals(text, SaveLink.text("teak://save?text=$encoded"))
    }

    @Test
    fun `reads text alongside other params and treats plus as a space`() {
        assertEquals("hello world", SaveLink.text("teak://save?from=shortcut&text=hello+world"))
    }

    @Test
    fun `returns nothing when there's no text to save`() {
        assertEquals("", SaveLink.text(null))
        assertEquals("", SaveLink.text("teak://save"))
        assertEquals("", SaveLink.text("teak://save?text=%20%20"))
        assertEquals("", SaveLink.text("teak://save?text=%E0%A4%A"))
    }
}
