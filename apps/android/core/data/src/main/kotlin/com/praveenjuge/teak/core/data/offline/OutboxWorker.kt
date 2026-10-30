package com.praveenjuge.teak.core.data.offline

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.praveenjuge.teak.core.data.auth.SessionManager
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.convex.isRetryable
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.repository.textCardArgs
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dev.convex.android.AuthState
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Sends the [Outbox]'s writes in the order they were made, once the account is signed in to Teak's server over a
 * live connection. A write that can go through later stays for the next run; one the server refuses is dropped.
 */
@HiltWorker
class OutboxWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val outbox: Outbox,
    private val convex: ConvexApi,
    private val client: ConvexClientWithAuth<String>,
    private val sessions: SessionManager,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // A run WorkManager starts with the app closed comes before the session is restored and the client signs in.
        val owner = withTimeoutOrNull(READY_TIMEOUT_MS) { signedInUser() } ?: return Result.retry()
        while (true) {
            val next = outbox.next() ?: return Result.success()
            if (next.ownerId == owner) {
                try {
                    send(next)
                } catch (e: TeakException) {
                    if (e.isRetryable) return Result.retry()
                    // The server refused it (the card is gone, a bad value): sending it again won't help.
                    Log.w(TAG, "Dropped a write the server refused: ${e.code}", e)
                }
            }
            // A write another account made never goes into this one.
            outbox.remove(next.id)
        }
    }

    /** The signed-in account's user id, once the client is authenticated over a live connection. */
    private suspend fun signedInUser(): String =
        combine(sessions.state, client.authState, convex.isConnected) { session, auth, connected ->
            (session as? SessionState.SignedIn)?.user?.id?.takeIf { auth is AuthState.Authenticated<*> && connected }
        }
            .filterNotNull()
            .first()

    private suspend fun send(item: OutboxItem) {
        when (item) {
            is OutboxItem.Edit -> convex.mutation(ConvexFunctions.updateCardField, item.change.args(item.cardId))
            is OutboxItem.CreateText -> convex.mutation(ConvexFunctions.createCard, textCardArgs(item.text))
        }
    }

    companion object {
        const val QUEUE = "teak-outbox"
        private const val TAG = "TeakOutbox"
        private const val READY_TIMEOUT_MS = 30_000L
    }
}
