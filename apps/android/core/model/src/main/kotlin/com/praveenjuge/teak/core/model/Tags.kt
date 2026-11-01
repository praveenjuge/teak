package com.praveenjuge.teak.core.model

/** A port of `packages/convex/shared/tags.ts`; keep them in step. */
object Tags {
    private val hiddenKeys = HIDDEN_TAG_KEYS.toSet()

    fun key(tag: String): String = tag.trim().lowercase()

    fun isHidden(tag: String): Boolean = key(tag) in hiddenKeys

    fun isHiddenList(tags: List<String>?): Boolean = tags.orEmpty().any(::isHidden)

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
}
