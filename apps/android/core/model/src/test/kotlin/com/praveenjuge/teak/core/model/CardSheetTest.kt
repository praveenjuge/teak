package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class CardSheetTest {
    private fun card(type: CardType) = Card(id = "c1", creationTime = 0.0, type = type)

    @Test
    fun `formats file sizes in 1024 steps`() {
        assertEquals("0 B", CardSheet.formatFileSize(0.0))
        assertEquals("512 B", CardSheet.formatFileSize(512.0))
        assertEquals("1 KB", CardSheet.formatFileSize(1024.0))
        assertEquals("4.6 MB", CardSheet.formatFileSize(4.6 * 1024 * 1024))
    }

    @Test
    fun `formats durations as minutes and seconds`() {
        assertEquals("1:05", CardSheet.formatDuration(65.9))
        assertEquals("0:00", CardSheet.formatDuration(-3.0))
    }

    @Test
    fun `download names never escape the downloads folder`() {
        assertEquals("a_b.png", CardSheet.downloadFileName(null, "a/b.png"))
        assertEquals("uuid-photo.heic", CardSheet.downloadFileName("https://files.test/users%2Fu1%2Fuuid-photo.heic?sig=1", null))
        assertEquals("download-42.m4a", CardSheet.downloadFileName(null, "..", "m4a", now = 42))
    }

    @Test
    fun `copies the URL for links and hex codes for palettes`() {
        assertEquals("https://a.test", CardSheet.copyText(card(CardType.Link).copy(url = " https://a.test ", content = "x")))
        assertEquals(
            "#fff, #000",
            CardSheet.copyText(card(CardType.Palette).copy(colors = listOf(CardColor("#fff"), CardColor("#000")))),
        )
        assertEquals(null, CardSheet.copyText(card(CardType.Text).copy(content = "  ")))
    }

    @Test
    fun `shares only original files for video, audio and documents`() {
        assertEquals(ShareTarget.None, CardSheet.shareTarget(card(CardType.Video).copy(thumbnailUrl = "https://t")))
        assertEquals(
            ShareTarget.File("https://t/thumb.jpg", "thumb.jpg", null),
            CardSheet.shareTarget(card(CardType.Image).copy(thumbnailUrl = "https://t/thumb.jpg", fileMetadata = FileMetadata(fileName = "photo.heic"))),
        )
    }

    @Test
    fun `detail rows describe the file`() {
        val rows = CardSheet.detailRows(
            card(CardType.Link).copy(
                url = "https://www.example.com/x",
                fileMetadata = FileMetadata(fileName = "a.pdf", fileSize = 2048.0, width = 10.0, height = 20.0, duration = 61.0),
            ),
        )
        assertEquals(
            listOf("Type" to "Link", "Website" to "example.com", "File" to "a.pdf", "Size" to "2 KB", "Dimensions" to "10 × 20", "Duration" to "1:01"),
            rows.map { it.label to it.value },
        )
    }
}
