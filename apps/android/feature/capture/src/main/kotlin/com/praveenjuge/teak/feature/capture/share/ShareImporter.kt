package com.praveenjuge.teak.feature.capture.share

import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/** How a share went. [detail] is the first failure worth showing, when there is one. */
sealed interface ShareResult {
    data object Empty : ShareResult
    data object SignInRequired : ShareResult
    data object Saved : ShareResult
    data class Partial(val saved: Int, val total: Int, val detail: String?) : ShareResult
    data class Failed(val detail: String?) : ShareResult
}

/**
 * Saves shared items: text becomes a note or link card right away, files are copied into the upload
 * queue and keep uploading after the share sheet closes. Like iOS, only the first
 * [MAX_FILES_PER_UPLOAD] items are saved.
 */
class ShareImporter @Inject constructor(
    private val cards: CardsRepository,
    private val uploads: UploadRepository,
    private val account: AccountRepository,
) {
    /** Calls [onSaving] once Teak knows the person is signed in and starts saving. */
    suspend fun import(items: List<ShareItem>, onSaving: () -> Unit = {}): ShareResult {
        if (items.isEmpty()) return ShareResult.Empty
        val session = account.session.first { it != SessionState.Loading }
        if (session !is SessionState.SignedIn) return ShareResult.SignInRequired
        onSaving()

        val processed = items.take(MAX_FILES_PER_UPLOAD)
        val extras = items.size - processed.size
        val failures = mutableListOf<String?>()

        for (item in processed.filterIsInstance<ShareItem.Text>()) {
            try {
                cards.createFromText(item.text)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failures += e.detail()
            }
        }

        val files = processed.filterIsInstance<ShareItem.File>()
        if (files.isNotEmpty()) {
            try {
                val staged = uploads.stage(files.map { it.uri })
                failures += staged.skipped.map { "${it.name}: ${it.reason}" }
                if (staged.files.isNotEmpty()) uploads.enqueue(staged.files)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                repeat(files.size) { failures += null }
            }
        }

        val saved = processed.size - failures.size
        val detail = failures.firstNotNullOfOrNull { it } ?: if (extras > 0) TOO_MANY_ITEMS else null
        return when {
            saved == items.size -> ShareResult.Saved
            saved > 0 -> ShareResult.Partial(saved, items.size, detail)
            else -> ShareResult.Failed(detail)
        }
    }

    /** Server messages that explain the failure better than "check your connection". */
    private fun Exception.detail(): String? =
        (this as? TeakException)?.takeIf { it.code in EXPLAINED_CODES }?.message

    companion object {
        val TOO_MANY_ITEMS = "Only the first $MAX_FILES_PER_UPLOAD shared items are processed."
        private val EXPLAINED_CODES = setOf(
            TeakException.CARD_LIMIT_REACHED,
            TeakException.FILE_TOO_LARGE,
            TeakException.RATE_LIMITED,
            TeakException.UNSUPPORTED_TYPE,
        )
    }
}
