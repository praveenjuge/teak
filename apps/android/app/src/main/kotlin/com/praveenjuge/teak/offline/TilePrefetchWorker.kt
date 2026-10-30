package com.praveenjuge.teak.offline

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ErrorResult
import coil3.request.ImageRequest
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.CardGrid
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * On Wi-Fi with battery to spare, loads the images of the newest cards into Coil's disk cache, so Home's tiles
 * show offline even for cards that haven't been scrolled to yet.
 */
@HiltWorker
class TilePrefetchWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val cards: CardsRepository,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val page = withTimeoutOrNull(LOAD_TIMEOUT_MS) { cards.page(CardQuery(), null, CARD_COUNT).first() }
            ?.getOrNull() ?: return Result.retry()
        val loader = SingletonImageLoader.get(applicationContext)
        for (card in page.page) {
            val url = CardGrid.tileImageUrl(card) ?: continue
            val result = loader.execute(
                ImageRequest.Builder(applicationContext)
                    .data(url)
                    .size(DECODE_SIZE_PX)
                    .memoryCachePolicy(CachePolicy.DISABLED)
                    .build(),
            )
            // A dropped connection retries soon instead of failing the rest; a broken image waits for the next run.
            if ((result as? ErrorResult)?.throwable is IOException) return Result.retry()
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "teak-tile-prefetch"
        private const val CARD_COUNT = 100
        private const val DECODE_SIZE_PX = 256
        private const val LOAD_TIMEOUT_MS = 30_000L

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<TilePrefetchWorker>(12, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.UNMETERED)
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
