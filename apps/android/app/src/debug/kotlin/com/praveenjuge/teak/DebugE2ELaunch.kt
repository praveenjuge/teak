package com.praveenjuge.teak

import android.content.Context
import android.util.AtomicFile
import com.praveenjuge.teak.core.data.auth.SessionParser
import com.praveenjuge.teak.core.data.auth.SessionStore
import com.praveenjuge.teak.core.data.auth.UserBootstrap
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.URI
import java.util.Base64
import javax.inject.Provider
import javax.inject.Singleton

/**
 * Debug builds only: `apps/android/scripts/e2e-session.ts` writes `files/e2e/launch.json` through
 * `adb shell run-as`, pointing the app at the local E2E stack with a signed-in emulator account.
 * Endpoints must be on this device (reached over `adb reverse`); anything else is ignored.
 */
@Serializable
private data class LaunchFile(
    val convexUrl: String,
    val workosUrl: String,
    val clientId: String? = null,
    val session: String? = null,
)

private class FileE2ELaunch(
    private val file: AtomicFile,
    private val launch: LaunchFile,
    private val store: Provider<SessionStore>,
    private val bootstrap: Provider<UserBootstrap>,
) : E2ELaunch {
    override val convexUrl: String = launch.convexUrl
    override val workosUrl: String = launch.workosUrl

    override suspend fun adoptSession() {
        val encoded = launch.session ?: return
        val clientId = launch.clientId ?: return
        val session = SessionParser.parseResponse(clientId, String(Base64.getDecoder().decode(encoded)))
        bootstrap.get().ensureUser(session.accessToken)
        store.get().saveSession(session)
        // Adopt once: later launches restore the saved session and refresh it like a real one.
        write(file, launch.copy(clientId = null, session = null))
    }
}

private val json = Json { ignoreUnknownKeys = true }

private fun write(file: AtomicFile, launch: LaunchFile) {
    val stream = file.startWrite()
    stream.write(json.encodeToString(LaunchFile.serializer(), launch).encodeToByteArray())
    file.finishWrite(stream)
}

private fun isLoopback(url: String): Boolean {
    val uri = runCatching { URI(url) }.getOrNull() ?: return false
    return uri.scheme in setOf("http", "https") && uri.host?.lowercase() in setOf("localhost", "127.0.0.1", "[::1]", "::1")
}

@Module
@InstallIn(SingletonComponent::class)
object DebugE2ELaunchModule {
    @Provides
    @Singleton
    fun e2eLaunch(
        @ApplicationContext context: Context,
        store: Provider<SessionStore>,
        bootstrap: Provider<UserBootstrap>,
    ): E2ELaunch {
        val file = AtomicFile(File(context.filesDir, "e2e/launch.json"))
        val launch = file.baseFile.takeIf(File::exists)
            ?.let { runCatching { json.decodeFromString(LaunchFile.serializer(), file.readFully().decodeToString()) }.getOrNull() }
            ?.takeIf { isLoopback(it.convexUrl) && isLoopback(it.workosUrl) }
            ?: return NoE2ELaunch
        return FileE2ELaunch(file, launch, store, bootstrap)
    }
}

private object NoE2ELaunch : E2ELaunch {
    override val convexUrl: String? = null
    override val workosUrl: String? = null
    override suspend fun adoptSession() = Unit
}
