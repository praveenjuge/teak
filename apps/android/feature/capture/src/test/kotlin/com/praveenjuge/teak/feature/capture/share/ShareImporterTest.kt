package com.praveenjuge.teak.feature.capture.share

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.upload.SkippedFile
import com.praveenjuge.teak.core.data.upload.StageResult
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.testing.FakeAccountRepository
import com.praveenjuge.teak.core.testing.FakeCardsRepository
import com.praveenjuge.teak.core.testing.FakeUploadRepository
import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class ShareImporterTest {
    private val cards = FakeCardsRepository()
    private val uploads = FakeUploadRepository()

    private fun importer(signedIn: Boolean = true) = ShareImporter(cards, uploads, FakeAccountRepository(signedIn))

    private fun staged(name: String) = StagedFile("/cache/uploads/$name", name, "image/png", 10)

    @Test
    fun `only the first five items are saved and the rest are reported`() = runTest {
        val items = (1..7).map { ShareItem.Text("note $it") }

        val result = importer().import(items)

        assertEquals((1..5).map { "note $it" }, cards.created)
        assertEquals(ShareResult.Partial(saved = 5, total = 7, detail = "Only the first 5 shared items are processed."), result)
    }

    @Test
    fun `text becomes a card and files join the upload queue`() = runTest {
        val photo = staged("photo.png")
        uploads.nextStage = StageResult(listOf(photo), emptyList())

        val result = importer().import(
            listOf(ShareItem.Text("https://teakvault.com"), ShareItem.File(Uri.parse("content://photos/1"))),
        )

        assertEquals(ShareResult.Saved, result)
        assertEquals(listOf("https://teakvault.com"), cards.created)
        assertEquals(listOf(photo), uploads.enqueued)
    }

    @Test
    fun `signed out shares ask to sign in and save nothing`() = runTest {
        val result = importer(signedIn = false).import(listOf(ShareItem.Text("hello")))

        assertEquals(ShareResult.SignInRequired, result)
        assertTrue(cards.created.isEmpty())
    }

    @Test
    fun `a skipped file makes a partial save with its reason`() = runTest {
        uploads.nextStage = StageResult(listOf(staged("a.png")), listOf(SkippedFile("movie.mov", "It's larger than 100 MB.")))

        val result = importer().import(
            listOf(
                ShareItem.Text("a note"),
                ShareItem.File(Uri.parse("content://files/a")),
                ShareItem.File(Uri.parse("content://files/movie")),
            ),
        )

        assertEquals(ShareResult.Partial(saved = 2, total = 3, detail = "movie.mov: It's larger than 100 MB."), result)
    }

    @Test
    fun `a full card limit fails with the server's message`() = runTest {
        cards.createError = TeakException(TeakException.CARD_LIMIT_REACHED, "You've reached the Free plan's card limit.")

        val result = importer().import(listOf(ShareItem.Text("a note")))

        assertEquals(ShareResult.Failed("You've reached the Free plan's card limit."), result)
    }

    @Test
    fun `a connection failure leaves the generic message to the sheet`() = runTest {
        cards.createError = TeakException(TeakException.OFFLINE, "Check your connection and try again.")

        val result = importer().import(listOf(ShareItem.Text("a note")))

        assertEquals(ShareResult.Failed(null), result)
    }

    @Test
    fun `nothing shared is empty`() = runTest {
        assertEquals(ShareResult.Empty, importer().import(emptyList()))
    }
}
