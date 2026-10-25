package com.praveenjuge.teak.core.model

/** A port of `packages/convex/shared/tags.ts`; keep them in step. */
object Tags {
    private val hiddenKeys = HIDDEN_TAG_KEYS.toSet()

    fun key(tag: String): String = tag.trim().lowercase()

    fun isHidden(tag: String): Boolean = key(tag) in hiddenKeys

    fun isHiddenList(tags: List<String>?): Boolean = tags.orEmpty().any(::isHidden)

    /** Why [name] can't be a tag, or null when it can. */
    fun invalidNameText(name: String): UiText? {
        val trimmed = name.trim()
        return when {
            trimmed.isEmpty() -> UiText.of("errors.tags.EMPTY_NAME")
            trimmed.length > MAX_TAG_NAME_LENGTH -> UiText.of("errors.tags.NAME_TOO_LONG", MAX_TAG_NAME_LENGTH.toString())
            else -> null
        }
    }

    fun existsText(name: String): UiText = UiText.of("errors.tags.TAG_EXISTS", name.trim())

    /**
     * The note shown after adding [tag] to a card that had [previousTags]: only when the tag hides a
     * card that was visible, as the web's tag input does.
     */
    fun hiddenHintText(previousTags: List<String>, tag: String): UiText? =
        if (isHidden(tag) && !isHiddenList(previousTags)) UiText.of("native.tags.card.hiddenAdded", key(tag)) else null

    /** The hint a library view shows when its only cards are hidden ones. */
    val hiddenCardsHint: UiText get() = UiText.of("native.tags.card.hiddenCards")

    // English only, for screens that haven't moved to the UiText versions above yet.

    fun explainInvalidName(name: String): String? {
        val trimmed = name.trim()
        return when {
            trimmed.isEmpty() -> TAG_ERROR_MESSAGES.getValue("EMPTY_NAME")
            trimmed.length > MAX_TAG_NAME_LENGTH -> TAG_ERROR_MESSAGES.getValue("NAME_TOO_LONG")
            else -> null
        }
    }

    fun existsMessage(name: String): String = "A tag named \"${name.trim()}\" already exists. Merge into it instead."

    fun hiddenHint(previousTags: List<String>, tag: String): String? =
        if (isHidden(tag) && !isHiddenList(previousTags)) "Hidden. Search #${key(tag)} to see it." else null

    const val HIDDEN_CARDS_HINT = "Some cards are hidden. Search #secret or #hidden to see them."
}
