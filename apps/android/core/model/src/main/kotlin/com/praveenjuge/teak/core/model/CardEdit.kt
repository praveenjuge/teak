package com.praveenjuge.teak.core.model

/** One `cards:updateCardField` write. */
sealed interface CardFieldChange {
    data class Content(val value: String) : CardFieldChange
    data class Notes(val value: String?) : CardFieldChange
    data class Tags(val value: List<String>) : CardFieldChange
    data class RemoveAiTag(val tag: String) : CardFieldChange
    data class MetadataTitle(val value: String) : CardFieldChange
    data class Url(val value: String) : CardFieldChange
    data object MoveToTrash : CardFieldChange
    data object Restore : CardFieldChange

    /** The mutation's arguments, as Apple's `CardFieldChange.args(cardId:)`. */
    fun args(cardId: String): Map<String, Any?> = when (this) {
        is Content -> mapOf("cardId" to cardId, "field" to "content", "value" to value)
        is Notes -> mapOf("cardId" to cardId, "field" to "notes", "value" to value)
        is Tags -> mapOf("cardId" to cardId, "field" to "tags", "value" to value)
        is RemoveAiTag -> mapOf("cardId" to cardId, "field" to "removeAiTag", "tagToRemove" to tag)
        is MetadataTitle -> mapOf("cardId" to cardId, "field" to "metadataTitle", "value" to value)
        is Url -> mapOf("cardId" to cardId, "field" to "url", "value" to value)
        MoveToTrash -> mapOf("cardId" to cardId, "field" to "delete")
        Restore -> mapOf("cardId" to cardId, "field" to "restore")
    }
}

data class CardEditDraft(
    val editableContent: String?,
    val notes: String,
    val tags: List<String>,
    val aiTags: List<String>,
)

object CardEdit {
    fun normalizeTag(value: String): String = value.trim().lowercase()

    fun canEditContent(type: CardType): Boolean = type == CardType.Text || type == CardType.Quote

    fun draftFor(card: Card): CardEditDraft = CardEditDraft(
        editableContent = if (canEditContent(card.type)) card.content else null,
        notes = card.notes.orEmpty(),
        tags = card.tags.orEmpty(),
        aiTags = card.aiTags.orEmpty(),
    )

    /**
     * The draft once [card] replaces [previous]: a field the person hasn't touched takes the new value, so
     * saving doesn't write an old copy over an edit made elsewhere, and Teak's tags that arrived since join
     * it, so saving doesn't remove tags the person never saw.
     */
    fun rebased(draft: CardEditDraft, previous: Card, card: Card): CardEditDraft {
        val base = draftFor(previous)
        val latest = draftFor(card)
        val known = previous.aiTags.orEmpty().toSet()
        val arrived = card.aiTags.orEmpty().filter { it !in known && it !in draft.aiTags }
        return draft.copy(
            editableContent = if (draft.editableContent == base.editableContent) latest.editableContent else draft.editableContent,
            notes = if (draft.notes == base.notes) latest.notes else draft.notes,
            tags = if (draft.tags == base.tags) latest.tags else draft.tags,
            aiTags = draft.aiTags + arrived,
        )
    }

    fun changes(card: Card, draft: CardEditDraft): List<CardFieldChange> = buildList {
        if (draft.editableContent != null && draft.editableContent != card.content) {
            add(CardFieldChange.Content(draft.editableContent))
        }
        val notes = draft.notes.trim()
        if (notes != card.notes.orEmpty().trim()) {
            add(CardFieldChange.Notes(notes.ifEmpty { null }))
        }
        if (draft.tags != card.tags.orEmpty()) {
            add(CardFieldChange.Tags(draft.tags))
        }
        for (tag in card.aiTags.orEmpty()) {
            if (tag !in draft.aiTags) add(CardFieldChange.RemoveAiTag(tag))
        }
    }

    /** Teak's tags the card doesn't already have as its own, for "Suggested by Teak". */
    fun suggestedTags(card: Card): List<String> {
        val own = card.tags.orEmpty().map(Tags::key).toSet()
        return card.aiTags.orEmpty().filter { tag -> Tags.key(tag).let { it.isNotEmpty() && it !in own } }
    }

    /** Keep: the card's tags plus a tag Teak suggested, as the web writes them. Null when the card has it already. */
    fun keeping(aiTag: String, tags: List<String>): CardFieldChange.Tags? {
        val key = Tags.key(aiTag)
        if (key.isEmpty() || tags.any { Tags.key(it) == key }) return null
        return CardFieldChange.Tags(tags + aiTag)
    }

    /** A link title typed in the header. Null when it's blank, so the title stays, or unchanged. */
    fun titleChange(input: String, current: String): CardFieldChange.MetadataTitle? {
        val title = input.trim()
        if (title.isEmpty() || title == current.trim()) return null
        return CardFieldChange.MetadataTitle(title)
    }
}

/** Changing a link card's address from Edit link… */
object LinkEdit {
    // An http or https scheme, then a host: what the server's `new URL` check needs, without spaces.
    private val link = Regex("""https?://([^/?#\s@]+@)?[^/?#\s:@]+(:\d*)?([/?#]\S*)?""", RegexOption.IGNORE_CASE)

    /** The server's words for an address it refuses. */
    val invalidMessage: UiText get() = UiText.of("native.card.editLink.invalid")

    /** Why [input] can't be saved, or null when it's an http or https link. */
    fun validationError(input: String): UiText? = if (link.matches(input.trim())) null else invalidMessage

    /** The write saving [input] makes, or null when it isn't a link or is the address the card has. */
    fun change(input: String, current: String?): CardFieldChange.Url? {
        val address = input.trim()
        if (validationError(address) != null || address == current) return null
        return CardFieldChange.Url(address)
    }
}

/** Emptying Trash: what the confirmation and the note after it say. */
object EmptyTrash {
    /** The confirmation: the count from `cards:trashCount`, as "or more" when Trash holds more. */
    fun message(count: Int, more: Boolean): UiText =
        if (more) UiText.of("native.trash.emptyMessageMore", count = count) else UiText.of("native.trash.emptyMessage", count = count)

    /** What `cards:emptyTrash` said it will delete. */
    fun done(trash: TrashCount): UiText = when {
        trash.cardCount <= 0 -> UiText.of("native.trash.alreadyEmpty")
        trash.more -> UiText.of("native.trash.emptyingMore", count = trash.cardCount)
        else -> UiText.of("native.trash.emptying", count = trash.cardCount)
    }

    /** Why emptying failed: the server's limit in the app's language, else its words or a general failure. */
    fun failure(code: String?, serverText: UiText?): UiText = when {
        code == "RATE_LIMITED" -> UiText.of("native.trash.rateLimited")
        else -> serverText ?: UiText.of("native.trash.emptyFailed")
    }
}
