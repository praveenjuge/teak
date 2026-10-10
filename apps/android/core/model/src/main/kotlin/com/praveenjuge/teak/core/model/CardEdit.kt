package com.praveenjuge.teak.core.model

/** One `cards:updateCardField` call. */
sealed interface CardFieldChange {
    data class Content(val value: String) : CardFieldChange
    data class Notes(val value: String?) : CardFieldChange
    data class Tags(val value: List<String>) : CardFieldChange
    data class RemoveAiTag(val tag: String) : CardFieldChange
}

/** What the edit screen holds. [content] is null for types whose content isn't editable. */
data class CardEditDraft(
    val content: String?,
    val notes: String,
    val tags: List<String>,
    val aiTags: List<String>,
)

object CardEdit {
    /** Tags are stored trimmed and lowercase, like the web's tag manager. */
    fun normalizeTag(value: String): String = value.trim().lowercase()

    /** Only text and quote cards let you rewrite their content. */
    fun canEditContent(type: CardType): Boolean = type == CardType.Text || type == CardType.Quote

    fun draftFor(card: Card): CardEditDraft = CardEditDraft(
        content = if (canEditContent(card.type)) card.content else null,
        notes = card.notes.orEmpty(),
        tags = card.tags.orEmpty(),
        aiTags = card.aiTags.orEmpty(),
    )

    /** The field updates that turn [card] into [draft], in save order. Only changed fields are sent. */
    fun changes(card: Card, draft: CardEditDraft): List<CardFieldChange> = buildList {
        if (draft.content != null && draft.content != card.content) {
            add(CardFieldChange.Content(draft.content))
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
}
