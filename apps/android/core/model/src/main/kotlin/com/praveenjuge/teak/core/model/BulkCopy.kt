package com.praveenjuge.teak.core.model

/** The words after a bulk change, as `apps/web/src/lib/bulkCardActions.ts` writes them. */
object BulkCopy {
    fun cardCount(count: Int): String = "$count card${if (count == 1) "" else "s"}"

    private fun done(action: BulkAction, cards: String, folder: String): String = when (action) {
        BulkAction.Favorite -> "Added $cards to favorites"
        BulkAction.Unfavorite -> "Removed $cards from favorites"
        BulkAction.Archive -> "Archived $cards"
        BulkAction.Unarchive -> "Returned $cards to the library"
        BulkAction.AddTags -> "Added tags to $cards"
        BulkAction.Delete -> "Moved $cards to Trash"
        BulkAction.Restore -> "Restored $cards"
        BulkAction.AddToFolder -> "Added $cards to $folder"
    }

    private fun failed(action: BulkAction): String = when (action) {
        BulkAction.Favorite -> "add these cards to favorites"
        BulkAction.Unfavorite -> "remove these cards from favorites"
        BulkAction.Archive -> "archive these cards"
        BulkAction.Unarchive -> "unarchive these cards"
        BulkAction.AddTags -> "add tags to these cards"
        BulkAction.Delete -> "move these cards to Trash"
        BulkAction.Restore -> "restore these cards"
        BulkAction.AddToFolder -> "add these cards to the folder"
    }

    /** "Archived 3 cards", "Archived 7 cards. 3 couldn't be changed." or "Couldn't archive these cards". */
    fun result(action: BulkAction, updated: Int, failedCount: Int, folder: String = "the folder"): String = when {
        updated == 0 -> "Couldn't ${failed(action)}"
        failedCount > 0 -> "${done(action, cardCount(updated), folder)}. $failedCount couldn't be changed."
        else -> done(action, cardCount(updated), folder)
    }

    /** The action that takes a change back, for the actions the web offers Undo on. */
    fun undoOf(action: BulkAction): BulkAction? = when (action) {
        BulkAction.Archive -> BulkAction.Unarchive
        BulkAction.Unarchive -> BulkAction.Archive
        BulkAction.Delete -> BulkAction.Restore
        else -> null
    }
}
