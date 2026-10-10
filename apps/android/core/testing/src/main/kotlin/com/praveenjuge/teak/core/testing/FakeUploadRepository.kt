package com.praveenjuge.teak.core.testing

import android.net.Uri
import com.praveenjuge.teak.core.data.upload.StageResult
import com.praveenjuge.teak.core.data.upload.StagedFile
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.data.upload.UploadStatus
import kotlinx.coroutines.flow.MutableStateFlow

class FakeUploadRepository : UploadRepository {
    var nextStage = StageResult(emptyList(), emptyList())
    val enqueued = mutableListOf<StagedFile>()
    override val uploads = MutableStateFlow<List<UploadStatus>>(emptyList())

    override suspend fun stage(uris: List<Uri>, metadata: (Uri) -> Map<String, Double>): StageResult = nextStage

    override fun enqueue(files: List<StagedFile>) {
        enqueued += files
    }

    override fun clearFinished() {
        uploads.value = uploads.value.filter { it.state == UploadStatus.State.Uploading || it.state == UploadStatus.State.Waiting }
    }
}
