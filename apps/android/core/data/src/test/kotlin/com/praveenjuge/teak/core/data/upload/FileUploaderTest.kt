package com.praveenjuge.teak.core.data.upload

import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.convex.TeakException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FileUploaderTest {
    @get:Rule val folder = TemporaryFolder()
    private val server = MockWebServer().apply { start() }
    private val convex = FakeConvexApi()
    private val uploader = FileUploader(convex, OkHttpClient())

    @After fun tearDown() = server.shutdown()

    private fun staged(bytes: ByteArray = "hello".toByteArray()): StagedFile {
        val file = folder.newFile("photo.jpg").apply { writeBytes(bytes) }
        return StagedFile(file.path, "photo.jpg", "image/jpeg", file.length(), mapOf("width" to 640.0))
    }

    private fun prepareSucceeds() {
        convex.responses["cards:uploadAndCreateCard"] = {
            buildJsonObject {
                put("success", true)
                put("uploadKey", "users/u1/photo.jpg")
                put("uploadUrl", server.url("/__upload/v1/key").toString())
            }
        }
        convex.responses["cards:finalizeUploadedCard"] = {
            buildJsonObject {
                put("success", true)
                put("cardId", "card_1")
            }
        }
    }

    @Test
    fun `prepares, PUTs the bytes, then finalizes with the stored file's ETag`() = runTest {
        prepareSucceeds()
        server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"abc123\""))

        assertEquals("card_1", uploader.upload(staged()))

        val put = server.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("image/jpeg", put.getHeader("Content-Type"))
        assertEquals("hello", put.body.readUtf8())
        val prepare = convex.calls.first { it.name == "cards:uploadAndCreateCard" }.args
        assertEquals(5.0, prepare["fileSize"], "numbers go to Convex as float64")
        val finalize = convex.calls.first { it.name == "cards:finalizeUploadedCard" }.args
        assertEquals("users/u1/photo.jpg", finalize["fileKey"])
        assertEquals("\"abc123\"", finalize["fileEtag"])
        assertEquals(mapOf("width" to 640.0), finalize["additionalMetadata"])
    }

    @Test
    fun `retries a server error, then succeeds`() = runTest {
        prepareSucceeds()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"e\""))
        assertEquals("card_1", uploader.upload(staged()))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `does not retry a rejected upload`() = runTest {
        prepareSucceeds()
        server.enqueue(MockResponse().setResponseCode(403))
        assertFailsWith<TeakException> { uploader.upload(staged()) }
        assertEquals(1, server.requestCount)
        assertEquals(null, convex.calls.firstOrNull { it.name == "cards:finalizeUploadedCard" })
    }

    @Test
    fun `passes on the server's card limit error`() = runTest {
        convex.responses["cards:uploadAndCreateCard"] = {
            buildJsonObject {
                put("success", false)
                put("errorCode", "CARD_LIMIT_REACHED")
                put("error", "You've reached the 200 card limit.")
            }
        }
        val error = assertFailsWith<TeakException> { uploader.upload(staged()) }
        assertEquals(TeakException.CARD_LIMIT_REACHED, error.code)
        assertEquals("You've reached the 200 card limit.", error.message)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `refuses files over 100 MB before calling the server`() = runTest {
        val file = staged().copy(size = 100L * 1024 * 1024 + 1)
        val error = assertFailsWith<TeakException> { uploader.upload(file) }
        assertEquals(TeakException.FILE_TOO_LARGE, error.code)
        assertEquals(emptyList(), convex.calls)
    }

}
