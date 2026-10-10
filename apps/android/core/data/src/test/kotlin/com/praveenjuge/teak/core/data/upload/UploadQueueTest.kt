package com.praveenjuge.teak.core.data.upload

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.convex.TeakException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** Uploads queued together run as a WorkManager chain; each must keep its own file. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class UploadQueueTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val server = MockWebServer().apply { start() }
    private val convex = FakeConvexApi()
    private val uploader = FileUploader(convex, OkHttpClient())

    @Before
    fun setUp() {
        convex.responses["cards:uploadAndCreateCard"] = {
            buildJsonObject {
                put("success", true)
                put("uploadKey", "users/u1/${it["fileName"]}")
                put("uploadUrl", server.url("/upload").toString())
            }
        }
        convex.responses["cards:finalizeUploadedCard"] = {
            buildJsonObject {
                put("success", true)
                put("cardId", "card_${it["fileName"]}")
            }
        }
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker =
                UploadWorker(appContext, workerParameters, uploader)
        }
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).setWorkerFactory(factory).build(),
        )
    }

    @After
    fun tearDown() = server.shutdown()

    private fun staged(name: String, mime: String): StagedFile {
        val file = File(context.cacheDir, "uploads/${name.hashCode()}/$name").apply {
            parentFile?.mkdirs()
            writeText("bytes of $name")
        }
        return StagedFile(file.path, name, mime, file.length())
    }

    /** Each upload waits for the network; release each one as the chain reaches it. */
    private fun runQueue() {
        val driver = requireNotNull(WorkManagerTestInitHelper.getTestDriver(context))
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            val infos = WorkManager.getInstance(context).getWorkInfosByTag(UploadWorker.TAG).get()
            if (infos.all { it.state.isFinished }) break
            infos.filter { it.state == WorkInfo.State.ENQUEUED }.forEach { driver.setAllConstraintsMet(it.id) }
            Thread.sleep(50)
        }
    }

    @Test
    fun `each queued file uploads under its own name and type`() {
        repeat(3) { server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"e$it\"")) }
        val repository = WorkManagerUploadRepository(context)
        repository.enqueue(
            listOf(
                staged("recording.m4a", "audio/mp4"),
                staged("photo.jpg", "image/jpeg"),
                staged("clip.mp4", "video/mp4"),
            ),
        )
        runQueue()

        val prepared = convex.calls.filter { it.name == "cards:uploadAndCreateCard" }.map { it.args["fileName"] to it.args["fileType"] }
        assertEquals(
            listOf("recording.m4a" to "audio/mp4", "photo.jpg" to "image/jpeg", "clip.mp4" to "video/mp4"),
            prepared,
        )
        val names = WorkManager.getInstance(context).getWorkInfosByTag(UploadWorker.TAG).get()
            .map { info -> info.tags.first { it.startsWith(UploadWorker.NAME_TAG_PREFIX) }.removePrefix(UploadWorker.NAME_TAG_PREFIX) }
            .toSet()
        assertEquals(setOf("recording.m4a", "photo.jpg", "clip.mp4"), names)
    }

    @Test
    fun `a full card limit stops the queue, explains every row and deletes every staged copy`() {
        convex.responses["cards:uploadAndCreateCard"] = {
            buildJsonObject {
                put("success", false)
                put("errorCode", TeakException.CARD_LIMIT_REACHED)
                put("error", "You've reached the Free plan's card limit.")
            }
        }
        val files = listOf(
            staged("recording.m4a", "audio/mp4"),
            staged("photo.jpg", "image/jpeg"),
            staged("clip.mp4", "video/mp4"),
        )
        val repository = WorkManagerUploadRepository(context)
        repository.enqueue(files)
        runQueue()

        assertEquals(1, convex.calls.count { it.name == "cards:uploadAndCreateCard" })
        files.forEach { assertFalse(File(it.path).parentFile!!.exists(), "${it.fileName} is still staged") }
        val rows = runBlocking { withTimeout(5_000) { repository.uploads.first { it.size == 3 } } }.associateBy { it.fileName }
        rows.values.forEach {
            assertEquals(UploadStatus.State.Failed, it.state)
            assertEquals(TeakException.CARD_LIMIT_REACHED, it.errorCode)
        }
        assertEquals("You've reached the Free plan's card limit.", rows.getValue("recording.m4a").error)
        assertEquals("Not uploaded because you've reached your card limit.", rows.getValue("photo.jpg").error)
        assertEquals("Not uploaded because you've reached your card limit.", rows.getValue("clip.mp4").error)
    }
}
