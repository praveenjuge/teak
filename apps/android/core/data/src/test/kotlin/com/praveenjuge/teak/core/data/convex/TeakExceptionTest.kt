package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.UiText
import org.junit.Test
import java.io.IOException
import kotlin.test.assertEquals

/** Apple's ConvexHTTPTests check the same codes. */
class TeakExceptionTest {
    @Test
    fun `known codes use the catalog's words`() {
        assertEquals(UiText.of("errors.folders.DUPLICATE_NAME"), TeakException("DUPLICATE_NAME", "Server words").text)
        assertEquals(UiText.of("errors.cards.TOO_MANY_FILES", "20"), TeakException("TOO_MANY_FILES", "x").text)
        assertEquals(UiText.of("native.errors.offline"), IOException("down").toTeakException().let { (it as TeakException).text })
    }

    @Test
    fun `a code more than one area throws keeps the server's words`() {
        assertEquals(UiText.verbatim("Folder not found"), TeakException("NOT_FOUND", "Folder not found").text)
        assertEquals(UiText.verbatim("Slow down"), TeakException("RATE_LIMITED", "Slow down").text)
        assertEquals(UiText.verbatim("Plain"), TeakException(null, "Plain").text)
    }
}
