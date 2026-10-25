package com.praveenjuge.teak.core.model

/** The words after a bulk change, as `apps/web/src/lib/bulkCardActions.ts` writes them. */
object BulkCopy {
    fun cardCount(count: Int): String = "$count card${if (count == 1) "" else "s"}"

    private fun done(action: BulkAction, count: Int, folder: String?): UiText = when (action) {
        BulkAction.Favorite -> UiText.of("native.bulk.done.favorite", count = count)
        BulkAction.Unfavorite -> UiText.of("native.bulk.done.unfavorite", count = count)
        BulkAction.Archive -> UiText.of("native.bulk.done.archive", count = count)
        BulkAction.Unarchive -> UiText.of("native.bulk.done.unarchive", count = count)
        BulkAction.AddTags -> UiText.of("native.bulk.done.addTags", count = count)
        BulkAction.Delete -> UiText.of("native.bulk.done.delete", count = count)
        BulkAction.Restore -> UiText.of("native.bulk.done.restore", count = count)
        BulkAction.AddToFolder -> folder?.let { UiText.of("native.bulk.done.addToFolder", it, count = count) }
            ?: UiText.of("native.bulk.done.addToTheFolder", count = count)
    }

    private fun failed(action: BulkAction): UiText = when (action) {
        BulkAction.Favorite -> UiText.of("native.bulk.failed.favorite")
        BulkAction.Unfavorite -> UiText.of("native.bulk.failed.unfavorite")
        BulkAction.Archive -> UiText.of("native.bulk.failed.archive")
        BulkAction.Unarchive -> UiText.of("native.bulk.failed.unarchive")
        BulkAction.AddTags -> UiText.of("native.bulk.failed.addTags")
        BulkAction.Delete -> UiText.of("native.bulk.failed.delete")
        BulkAction.Restore -> UiText.of("native.bulk.failed.restore")
        BulkAction.AddToFolder -> UiText.of("native.bulk.failed.addToFolder")
    }

    /** "Archived 7 cards" with ". 3 couldn't be changed." added when some failed. */
    fun partial(done: UiText, failedCount: Int): UiText =
        if (failedCount > 0) UiText.of("native.bulk.partial", done, count = failedCount) else done

    /** "Archived 3 cards", "Archived 7 cards. 3 couldn't be changed." or "Couldn't archive these cards". */
    fun result(action: BulkAction, updated: Int, failedCount: Int, folder: String? = null): UiText =
        if (updated == 0) failed(action) else partial(done(action, updated, folder), failedCount)

    /** The action that takes a change back, for the actions the web offers Undo on. */
    fun undoOf(action: BulkAction): BulkAction? = when (action) {
        BulkAction.Archive -> BulkAction.Unarchive
        BulkAction.Unarchive -> BulkAction.Archive
        BulkAction.Delete -> BulkAction.Restore
        else -> null
    }
}
