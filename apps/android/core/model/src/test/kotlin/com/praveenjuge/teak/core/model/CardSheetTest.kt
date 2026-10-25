package com.praveenjuge.teak.core.model

import org.junit.Test
import java.util.Locale
import kotlin.test.assertEquals

class CardSheetTest {
    private fun card(type: CardType) = Card(id = "c1", creationTime = 0.0, type = type)

    @Test
    fun `formats file sizes in 1024 steps`() {
        assertEquals("0 B", CardSheet.formatFileSize(0.0, Locale.US))
        assertEquals("512 B", CardSheet.formatFileSize(512.0, Locale.US))
        assertEquals("1 KB", CardSheet.formatFileSize(1024.0, Locale.US))
        assertEquals("4.6 MB", CardSheet.formatFileSize(4.6 * 1024 * 1024, Locale.US))
        assertEquals("4,6 MB", CardSheet.formatFileSize(4.6 * 1024 * 1024, Locale.GERMANY))
        assertEquals("1000 B", CardSheet.formatFileSize(1000.0, Locale.US))
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
            Locale.US,
        )
        assertEquals(
            listOf(
                "type" to UiText.of("cards.types.link"),
                "website" to UiText.verbatim("example.com"),
                "file" to UiText.verbatim("a.pdf"),
                "size" to UiText.verbatim("2 KB"),
                "dimensions" to UiText.verbatim("10 × 20"),
                "duration" to UiText.verbatim("1:01"),
            ).map { (key, value) -> DetailRow(UiText.of("native.details.$key"), value) },
            rows,
        )
    }

    @Test
    fun `file facts count with plurals and drop a kind that repeats the type`() {
        val doc = card(CardType.Document).copy(
            fileMetadata = FileMetadata(kind = "document", preview = FilePreviewFacts(slideCount = 1.0, wordCount = 1200.0)),
        )
        assertEquals(
            listOf(UiText.of("native.details.slides", count = 1), UiText.of("native.details.words", count = 1200)),
            CardSheet.fileFacts(doc),
        )
        assertEquals(UiText.of("native.card.note"), CardSheet.title(card(CardType.Text)))
        assertEquals(UiText.of("cards.types.image"), CardSheet.title(card(CardType.Image)))
    }
}
