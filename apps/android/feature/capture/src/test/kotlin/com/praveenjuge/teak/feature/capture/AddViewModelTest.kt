package com.praveenjuge.teak.feature.capture

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.praveenjuge.teak.core.data.upload.SkippedFile
import com.praveenjuge.teak.core.data.upload.StageResult
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.testing.FakeUploadRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class AddViewModelTest {
    @get:Rule val mainDispatcher = MainDispatcherRule()

    private val uploads = FakeUploadRepository()

    private fun uris(count: Int) = (1..count).map { Uri.parse("content://files/$it") }

    @Test
    fun `more than five files are refused with an alert`() = runTest {
        val viewModel = AddViewModel(uploads)
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        uploads.nextStage = StageResult(listOf(StagedFile("/a", "a.png", "image/png", 1)), emptyList())

        viewModel.upload(uris(6))

        assertEquals(AddAlert.TooManyFiles, viewModel.uiState.value.alert)
        assertTrue(uploads.enqueued.isEmpty())
    }

    @Test
    fun `skipped files are listed and the rest are queued`() = runTest {
        val viewModel = AddViewModel(uploads)
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.uiState.collect() }
        val photo = StagedFile("/a", "a.png", "image/png", 1)
        val skipped = SkippedFile("huge.mov", "It's larger than 100 MB.")
        uploads.nextStage = StageResult(listOf(photo), listOf(skipped))

        viewModel.upload(uris(2))

        assertEquals(AddAlert.Skipped(listOf(skipped)), viewModel.uiState.value.alert)
        assertEquals(listOf(photo), uploads.enqueued)
    }
}
