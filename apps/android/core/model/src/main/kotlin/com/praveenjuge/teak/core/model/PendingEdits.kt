package com.praveenjuge.teak.core.model

/**
 * Edits saved on the device that the server hasn't confirmed yet, laid over what the server last sent, so a
 * card changed offline shows the change at once. They apply in the order they were made, as the server will
 * apply them; [now] stands in for the server's time on a card marked done.
 */
object PendingEdits {
    fun apply(card: Card, changes: List<CardFieldChange>, now: Double): Card =
        changes.fold(card) { current, change -> apply(current, change, now) }

    fun apply(summary: CardSummary, changes: List<CardFieldChange>, now: Double): CardSummary =
        changes.fold(summary) { current, change -> apply(current, change, now) }

    /** Whether a card with [changes] still belongs in a library view filtered by [filters]. */
    fun keepsInView(changes: List<CardFieldChange>, filters: LibraryFilters): Boolean {
        var trashed: Boolean? = null
        var archived: Boolean? = null
        var favorited: Boolean? = null
        for (change in changes) {
            when (change) {
                CardFieldChange.MoveToTrash -> trashed = true
                CardFieldChange.Restore -> trashed = false
                is CardFieldChange.Archive -> archived = change.value
                is CardFieldChange.Favorite -> favorited = change.value
                else -> Unit
            }
        }
        return when {
            filters.trashOnly -> trashed != false
            trashed == true -> false
            filters.archivedOnly && archived == false -> false
            !filters.archivedOnly && archived == true -> false
            filters.favoritesOnly && favorited == false -> false
            else -> true
        }
    }

    private fun apply(card: Card, change: CardFieldChange, now: Double): Card = when (change) {
        is CardFieldChange.Content -> card.copy(content = change.value)
        is CardFieldChange.Notes -> card.copy(notes = change.value)
        is CardFieldChange.Tags -> card.copy(tags = change.value)
        is CardFieldChange.RemoveAiTag -> card.copy(aiTags = card.aiTags.orEmpty() - change.tag)
        is CardFieldChange.MetadataTitle -> card.copy(metadataTitle = change.value, metadataTitleEdited = true)
        is CardFieldChange.Url -> card.copy(url = change.value)
        is CardFieldChange.AddColor ->
            if (PaletteEdit.contains(card, change.hex)) card else card.copy(colors = card.colors.orEmpty() + CardColor(change.hex))
        is CardFieldChange.RemoveColor ->
            card.copy(colors = card.colors.orEmpty().filterNot { PaletteEdit.storedHex(it) == change.hex })
        is CardFieldChange.Favorite -> card.copy(isFavorited = change.value)
        is CardFieldChange.Archive -> card.copy(isArchived = change.value.takeIf { it })
        is CardFieldChange.Done -> card.copy(completedAt = if (change.value) card.completedAt ?: now else null)
        CardFieldChange.MoveToTrash -> card.copy(isDeleted = true)
        CardFieldChange.Restore -> card.copy(isDeleted = null)
    }

    private fun apply(summary: CardSummary, change: CardFieldChange, now: Double): CardSummary = when (change) {
        is CardFieldChange.Favorite -> summary.copy(isFavorited = change.value)
        is CardFieldChange.Archive -> summary.copy(isArchived = change.value.takeIf { it })
        is CardFieldChange.Done -> summary.copy(completedAt = if (change.value) summary.completedAt ?: now else null)
        is CardFieldChange.AddColor ->
            if (summary.colors.orEmpty().any { PaletteEdit.normalizedHex(it) == change.hex }) summary
            else summary.copy(colors = summary.colors.orEmpty() + change.hex)
        is CardFieldChange.RemoveColor ->
            summary.copy(colors = summary.colors.orEmpty().filterNot { PaletteEdit.storedHex(CardColor(it)) == change.hex })
        // A tile shows none of the other fields, or the server works out what it shows from them.
        else -> summary
    }
}
