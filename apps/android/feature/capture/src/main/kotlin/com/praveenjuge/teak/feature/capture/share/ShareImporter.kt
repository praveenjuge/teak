package com.praveenjuge.teak.feature.capture.share

import com.praveenjuge.teak.core.data.auth.SessionState
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.AccountRepository
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.data.upload.UploadRepository
import com.praveenjuge.teak.core.model.MAX_FILES_PER_UPLOAD
import com.praveenjuge.teak.core.model.UiText
import kotlinx.coroutines.flow.first
import javax.inject.Inject

sealed interface ShareResult {
    data object Empty : ShareResult
    data object SignInRequired : ShareResult
    /** Everything was saved; [cardIds] are the text and link cards made right away (files upload later, and text saved offline waits). */
    data class Saved(val cardIds: List<String> = emptyList()) : ShareResult
    data class Partial(val saved: Int, val total: Int, val detail: UiText?) : ShareResult
    data class Failed(val detail: UiText?) : ShareResult
}

class ShareImporter @Inject constructor(
    private val cards: CardsRepository,
    private val uploads: UploadRepository,
    private val account: AccountRepository,
) {
    suspend fun import(items: List<ShareItem>, onSaving: () -> Unit = {}): ShareResult {
        if (items.isEmpty()) return ShareResult.Empty
        val session = account.session.first { it != SessionState.Loading }
        if (session !is SessionState.SignedIn) return ShareResult.SignInRequired
        onSaving()

        val processed = items.take(MAX_FILES_PER_UPLOAD)
        val extras = items.size - processed.size
        val failures = mutableListOf<UiText?>()
        val created = mutableListOf<String>()

        for (item in processed.filterIsInstance<ShareItem.Text>()) {
            catchingFailures { cards.createFromText(item.text) }
                // Offline, the text waits to be saved and has no card yet to add tags or a note to.
                .onSuccess { id -> id?.let { created += it } }
                .onFailure { failures += it.detail() }
        }

        val files = processed.filterIsInstance<ShareItem.File>()
        if (files.isNotEmpty()) {
            catchingFailures {
                val staged = uploads.stage(files.map { it.uri })
                failures += staged.skipped.map { UiText.of("native.capture.skippedFile", it.name, it.reasonText) }
                if (staged.files.isNotEmpty()) uploads.enqueue(staged.files)
            }.onFailure { repeat(files.size) { failures += null } }
        }

        val saved = processed.size - failures.size
        val detail = failures.firstNotNullOfOrNull { it } ?: if (extras > 0) TOO_MANY_ITEMS else null
        return when {
            saved == items.size -> ShareResult.Saved(created)
            saved > 0 -> ShareResult.Partial(saved, items.size, detail)
            else -> ShareResult.Failed(detail)
        }
    }

    /** The failure in the app's own words when it has them; the sheet says something general otherwise. */
    private fun Throwable.detail(): UiText? =
        (this as? TeakException)?.text?.takeIf { it is UiText.Message }

    companion object {
        val TOO_MANY_ITEMS: UiText = UiText.of("native.share.tooManyItems", MAX_FILES_PER_UPLOAD.toString())
    }
}
