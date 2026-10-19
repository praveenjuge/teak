package com.praveenjuge.teak.core.model

sealed interface CardFieldChange {
    data class Content(val value: String) : CardFieldChange
    data class Notes(val value: String?) : CardFieldChange
    data class Tags(val value: List<String>) : CardFieldChange
    data class RemoveAiTag(val tag: String) : CardFieldChange
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
}
