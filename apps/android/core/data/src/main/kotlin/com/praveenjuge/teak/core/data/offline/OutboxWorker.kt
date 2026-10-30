package com.praveenjuge.teak.core.data.offline

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.isOffline
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.repository.textCardArgs
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/** Sends the [Outbox]'s writes in the order they were made, once Teak's connection is up. */
@HiltWorker
class OutboxWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val outbox: Outbox,
    private val convex: ConvexApi,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        withTimeoutOrNull(CONNECT_TIMEOUT_MS) { convex.isConnected.first { it } } ?: return Result.retry()
        while (true) {
            val next = outbox.next() ?: return Result.success()
            try {
                send(next)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e.isOffline) return Result.retry()
                // The server refused it (the card is gone, a limit, a bad value): sending it again won't help.
                Log.w(TAG, "Dropped a write the server refused", e)
            }
            outbox.remove(next.id)
        }
    }

    private suspend fun send(item: OutboxItem) {
        when (item) {
            is OutboxItem.Edit -> convex.mutation(ConvexFunctions.updateCardField, item.change.args(item.cardId))
            is OutboxItem.CreateText -> convex.mutation(ConvexFunctions.createCard, textCardArgs(item.text))
        }
    }

    companion object {
        const val QUEUE = "teak-outbox"
        private const val TAG = "TeakOutbox"
        private const val CONNECT_TIMEOUT_MS = 30_000L
    }
}
