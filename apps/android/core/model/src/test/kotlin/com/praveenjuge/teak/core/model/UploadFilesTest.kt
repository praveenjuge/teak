package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Runs the rows in `fileNames.json`, which `packages/convex/__tests__/shared/fileFormats.test.ts` runs too. */
class UploadFilesTest {
    @Serializable
    private data class Rows(val valid: List<String>, val invalid: List<String>)

    private val rows = Fixtures.load<Rows>("fileNames")

    @Test
    fun `refuses the names the backend refuses`() {
        for (name in rows.valid) assertEquals(name.trim(), UploadFiles.validName(name), name)
        for (name in rows.invalid) assertNull(UploadFiles.validName(name), name)
    }

    @Test
    fun `renames a file so the backend always takes it`() {
        for (name in rows.valid + rows.invalid) {
            assertNotNull(UploadFiles.validName(UploadFiles.safeName(name, fallback = "upload_1")), name)
        }
        assertEquals(".._secret.json", UploadFiles.safeName("../secret.json", fallback = "upload_1"))
        assertEquals("bad_.json", UploadFiles.safeName("bad\u0000.json", fallback = "upload_1"))
        assertEquals("upload_1", UploadFiles.safeName("..", fallback = "upload_1"))
        val long = UploadFiles.safeName("a".repeat(300) + ".pdf", fallback = "upload_1")
        assertEquals(MAX_FILE_NAME_LENGTH, long.length)
        assertTrue(long.endsWith("a.pdf"))
    }

    @Test
    fun `reads a generic type from the name, as the backend would`() {
        for (generic in GENERIC_MIME_TYPES + listOf("application/unknown", "*/*", "Application/Octet-Stream; charset=binary")) {
            assertEquals("image/png", UploadFiles.mimeType(generic, "image/png"), generic)
        }
        assertEquals("image/jpeg", UploadFiles.mimeType("image/jpeg", "image/png"))
        assertEquals("application/octet-stream", UploadFiles.mimeType(null, null))
    }
}
