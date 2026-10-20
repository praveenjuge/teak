package com.praveenjuge.teak.core.model

/** A port of `packages/convex/shared/tags.ts`; keep them in step. */
object Tags {
    private val hiddenKeys = HIDDEN_TAG_KEYS.toSet()

    fun key(tag: String): String = tag.trim().lowercase()

    fun isHidden(tag: String): Boolean = key(tag) in hiddenKeys

    fun isHiddenList(tags: List<String>?): Boolean = tags.orEmpty().any(::isHidden)

    /** Why [name] can't be a tag, or null when it can. */
    fun explainInvalidName(name: String): String? {
        val trimmed = name.trim()
        return when {
            trimmed.isEmpty() -> TAG_ERROR_MESSAGES.getValue("EMPTY_NAME")
            trimmed.length > MAX_TAG_NAME_LENGTH -> TAG_ERROR_MESSAGES.getValue("NAME_TOO_LONG")
            else -> null
        }
    }

    fun existsMessage(name: String): String = "A tag named \"${name.trim()}\" already exists. Merge into it instead."

    /**
     * The note shown after adding [tag] to a card that had [previousTags]: only when the tag hides a
     * card that was visible, as the web's tag input does.
     */
    fun hiddenHint(previousTags: List<String>, tag: String): String? =
        if (isHidden(tag) && !isHiddenList(previousTags)) "Hidden. Search #${key(tag)} to see it." else null

    /** The hint a library view shows when its only cards are hidden ones. */
    const val HIDDEN_CARDS_HINT = "Some cards are hidden. Search #secret or #hidden to see them."
}
