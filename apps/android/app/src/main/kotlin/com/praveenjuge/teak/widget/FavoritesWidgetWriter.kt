package com.praveenjuge.teak.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.graphics.scale
import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.data.di.ApplicationScope
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.FavoritesSnapshot
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps the Favorites widget's snapshot in the app's files, as Apple's `FavoritesWidgetWriter`: while signed in it
 * follows the newest favorites, saves them with small thumbnails and redraws the widget. Signing out deletes it,
 * so the widget never shows another account's cards.
 */
@Singleton
class FavoritesWidgetWriter @Inject constructor(
    @ApplicationContext private val context: Context,
    private val account: AccountRepository,
    private val convex: ConvexApi,
    private val httpClient: OkHttpClient,
    @ApplicationScope private val scope: CoroutineScope,
) {
    private val folder = FavoritesSnapshot.folder(context.filesDir)

    fun start() {
        scope.launch {
            // collectLatest stops following the last account, and waits for it, before it clears or follows the
            // next one, so nothing saved late lands in another account's widget.
            account.session
                .distinctUntilChangedBy { (it as? SessionState.SignedIn)?.user?.id ?: it }
                .collectLatest { session ->
                    when (session) {
                        is SessionState.SignedIn -> follow()
                        SessionState.SignedOut -> clear()
                        SessionState.Loading -> Unit
                    }
                }
        }
    }

    private suspend fun follow() {
        while (true) {
            catchingFailures {
                convex.subscribe(ConvexFunctions.searchCardSummaries, FavoritesSnapshot.searchArgs).collect { result ->
                    // Until it's signed in, the server answers as no one: an empty page that isn't the account's.
                    val page = result.getOrNull()?.page ?: return@collect
                    if (!convex.authenticatedNow) return@collect
                    if (save(page)) FavoritesWidget.redraw(context)
                }
            }
            delay(RETRY_MS)
        }
    }

    private suspend fun clear() {
        if (withContext(Dispatchers.IO) { FavoritesSnapshot.clear(folder) }) FavoritesWidget.redraw(context)
    }

    /** Writes the favorites, fetching only thumbnails not saved yet. False when nothing changed. */
    private suspend fun save(page: List<CardSummary>): Boolean = withContext(Dispatchers.IO) {
        val favorites = page.mapNotNull(FavoritesSnapshot.Card::from).take(FavoritesSnapshot.LIMIT)
        val images = buildMap {
            for ((card, url) in favorites) {
                val name = card.image ?: continue
                if (url == null || File(folder, name).exists()) continue
                thumbnail(url)?.let { put(name, it) }
            }
        }
        // A thumbnail that failed to load shows the card's words until the next try.
        val cards = favorites.map { (card, _) ->
            val name = card.image
            if (name != null && name !in images && !File(folder, name).exists()) card.copy(image = null) else card
        }
        val snapshot = FavoritesSnapshot(cards)
        ensureActive()
        if (snapshot == FavoritesSnapshot.read(folder) && images.isEmpty()) return@withContext false
        snapshot.write(folder, images)
        true
    }

    /** The image at [url] as a JPEG no larger than [THUMBNAIL_PX] on its longer side, or null when it won't load. */
    private fun thumbnail(url: String): ByteArray? = runCatching {
        val bytes = httpClient.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.bytes() ?: return null
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= THUMBNAIL_PX) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null
        val scale = THUMBNAIL_PX.toFloat() / maxOf(decoded.width, decoded.height)
        val bitmap = if (scale < 1) decoded.scale((decoded.width * scale).toInt(), (decoded.height * scale).toInt()) else decoded
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            out.toByteArray()
        }
    }.getOrNull()

    private companion object {
        /** Large tiles are about 160dp wide, at up to 3x. */
        const val THUMBNAIL_PX = 480
        const val JPEG_QUALITY = 85
        const val RETRY_MS = 5_000L
    }
}
