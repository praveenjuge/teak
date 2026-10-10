package com.praveenjuge.teak.core.data.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

/** Where the signed-in session and an in-flight sign-in live between launches. */
interface SessionStore {
    suspend fun loadSession(): AuthSession?
    suspend fun saveSession(session: AuthSession)
    suspend fun clearSession()
    suspend fun loadPending(): PendingSignIn?
    suspend fun savePending(pending: PendingSignIn)
    suspend fun clearPending()
}

/**
 * Stores sessions encrypted with an AES-GCM key that never leaves Android Keystore. Files live in
 * no-backup storage, so tokens are never copied to cloud backups or a new phone.
 */
@Singleton
class KeystoreSessionStore @Inject constructor(
    @ApplicationContext context: Context,
) : SessionStore {
    private val directory = File(context.noBackupFilesDir, "auth").apply { mkdirs() }
    private val sessionFile = AtomicFile(File(directory, "session.bin"))
    private val pendingFile = AtomicFile(File(directory, "pending.bin"))
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()

    override suspend fun loadSession(): AuthSession? = read(sessionFile, AuthSession.serializer())
    override suspend fun saveSession(session: AuthSession) = write(sessionFile, AuthSession.serializer(), session)
    override suspend fun clearSession() = delete(sessionFile)
    override suspend fun loadPending(): PendingSignIn? = read(pendingFile, PendingSignIn.serializer())
    override suspend fun savePending(pending: PendingSignIn) = write(pendingFile, PendingSignIn.serializer(), pending)
    override suspend fun clearPending() = delete(pendingFile)

    private suspend fun <T> read(file: AtomicFile, serializer: KSerializer<T>): T? = locked {
        if (!file.baseFile.exists()) return@locked null
        try {
            val bytes = decrypt(file.readFully())
            json.decodeFromString(serializer, bytes.decodeToString())
        } catch (e: IOException) {
            null
        } catch (e: GeneralSecurityException) {
            // The key was lost (for example after a lock-screen reset). The session can't be read, so drop it.
            file.delete()
            null
        } catch (e: IllegalArgumentException) {
            file.delete()
            null
        }
    }

    private suspend fun <T> write(file: AtomicFile, serializer: KSerializer<T>, value: T) = locked {
        val bytes = encrypt(json.encodeToString(serializer, value).encodeToByteArray())
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
            throw e
        }
    }

    private suspend fun delete(file: AtomicFile) = locked { file.delete() }

    private suspend fun <T> locked(block: () -> T): T =
        withContext(Dispatchers.IO) { mutex.withLock { block() } }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return cipher.iv + cipher.doFinal(plain)
    }

    private fun decrypt(data: ByteArray): ByteArray {
        if (data.size <= IV_SIZE) throw GeneralSecurityException("Truncated session")
        val cipher = Cipher.getInstance(TRANSFORMATION)
        // This IV was made by the Keystore in encrypt(): the key requires randomized encryption, so every
        // encryption gets a fresh random IV and a caller-supplied one is refused. No IV is ever reused.
        // nosemgrep: kotlin.lang.security.gcm-detection.gcm-detection
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, IV_SIZE))
        return cipher.doFinal(data, IV_SIZE, data.size - IV_SIZE)
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "teak.session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}
