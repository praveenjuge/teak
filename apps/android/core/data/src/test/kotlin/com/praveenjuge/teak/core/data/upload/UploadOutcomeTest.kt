package com.praveenjuge.teak.core.data.upload

import androidx.work.Data
import androidx.work.WorkInfo
import androidx.work.workDataOf
import com.praveenjuge.teak.core.data.convex.TeakException
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class UploadOutcomeTest {
    private fun legacyError(code: String) =
        workDataOf(UploadWorker.Output.ERROR to "boom", UploadWorker.Output.ERROR_CODE to code)

    @Test
    fun `a recorded outcome wins over the work state`() {
        val output = workDataOf(UploadWorker.Output.OUTCOME to UploadOutcome.Failed.name)
        assertEquals(UploadOutcome.Failed, uploadOutcome(WorkInfo.State.SUCCEEDED, output))
    }

    @Test
    fun `a legacy row that succeeded with an error is a failed upload`() {
        assertEquals(UploadOutcome.Failed, uploadOutcome(WorkInfo.State.SUCCEEDED, legacyError("SERVER_ERROR")))
    }

    @Test
    fun `a legacy row that failed with an error hit the card limit`() {
        assertEquals(
            UploadOutcome.LimitReached,
            uploadOutcome(WorkInfo.State.FAILED, legacyError(TeakException.CARD_LIMIT_REACHED)),
        )
    }

    @Test
    fun `a failed row with no output never ran`() {
        assertEquals(UploadOutcome.NotRunAfterLimit, uploadOutcome(WorkInfo.State.FAILED, Data.EMPTY))
    }

    @Test
    fun `a legacy row that saved has no failure outcome`() {
        assertNull(uploadOutcome(WorkInfo.State.SUCCEEDED, workDataOf(UploadWorker.Output.NAME to "a.png")))
    }

    @Test
    fun `an unfinished row has no outcome yet`() {
        assertNull(uploadOutcome(WorkInfo.State.RUNNING, legacyError("SERVER_ERROR")))
    }
}
