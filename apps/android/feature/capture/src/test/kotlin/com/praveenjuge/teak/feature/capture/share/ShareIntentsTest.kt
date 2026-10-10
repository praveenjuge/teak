package com.praveenjuge.teak.feature.capture.share

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class ShareIntentsTest {
    @Test
    fun `shared text becomes one trimmed text item`() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "  https://teakvault.com/post  ")
            .putExtra(Intent.EXTRA_SUBJECT, "A post")

        assertEquals(listOf(ShareItem.Text("https://teakvault.com/post")), ShareIntents.items(intent))
    }

    @Test
    fun `the subject stands in only when nothing else was shared`() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Reading list")

        assertEquals(listOf(ShareItem.Text("Reading list")), ShareIntents.items(intent))
    }

    @Test
    fun `a shared image with a subject is just the file`() {
        val photo = Uri.parse("content://media/photo/1")
        val intent = Intent(Intent.ACTION_SEND).setType("image/jpeg")
            .putExtra(Intent.EXTRA_STREAM, photo)
            .putExtra(Intent.EXTRA_SUBJECT, "IMG_0001")

        assertEquals(listOf(ShareItem.File(photo)), ShareIntents.items(intent))
    }

    @Test
    fun `multiple shared streams become file items once each`() {
        val first = Uri.parse("content://media/photo/1")
        val second = Uri.parse("content://media/video/2")
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*")
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first, second))
        intent.clipData = ClipData.newRawUri("", first).apply { addItem(ClipData.Item(second)) }

        assertEquals(listOf(ShareItem.File(first), ShareItem.File(second)), ShareIntents.items(intent))
    }

    @Test
    fun `selected text is saved and handed back unchanged when editable`() {
        val intent = Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain")
            .putExtra(Intent.EXTRA_PROCESS_TEXT, "a quote worth keeping")
            .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)

        assertEquals(listOf(ShareItem.Text("a quote worth keeping")), ShareIntents.items(intent))
        assertEquals("a quote worth keeping", ShareIntents.processTextReply(intent)?.getStringExtra(Intent.EXTRA_PROCESS_TEXT))
    }

    @Test
    fun `read-only selected text gets no reply`() {
        val intent = Intent(Intent.ACTION_PROCESS_TEXT)
            .putExtra(Intent.EXTRA_PROCESS_TEXT, "read only")
            .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)

        assertNull(ShareIntents.processTextReply(intent))
    }

    @Test
    fun `a save link keeps plus signs as spaces and escaped hashes as hashes`() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("teak://save?text=Ideas+for+%23teak+2%2B2"))

        assertEquals(listOf(ShareItem.Text("Ideas for #teak 2+2")), ShareIntents.items(intent))
    }

    @Test
    fun `a save link without text has nothing to save`() {
        assertEquals(emptyList(), ShareIntents.items(Intent(Intent.ACTION_VIEW, Uri.parse("teak://save"))))
    }
}
