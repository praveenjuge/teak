package com.praveenjuge.teak.core.model

/**
 * Tags typed for many cards at once ("design, inspiration"), or why they can't be added:
 * `cards:bulkUpdateCards` takes at most [MAX_BULK_TAGS]. Apple's `BulkTags` reads the same fixture rows.
 */
data class BulkTags(val tags: List<String>, val error: UiText? = null) {
    val canAdd: Boolean get() = error == null && tags.isNotEmpty()

    companion object {
        fun parse(text: String): BulkTags {
            val tags = text.split(',').map(CardEdit::normalizeTag).filter(String::isNotEmpty).distinct()
            return when {
                tags.any { it.length > MAX_TAG_NAME_LENGTH } -> BulkTags(tags, UiText.of("errors.tags.NAME_TOO_LONG", MAX_TAG_NAME_LENGTH))
                tags.size > MAX_BULK_TAGS -> BulkTags(tags, UiText.of("native.bulk.tooManyTags", MAX_BULK_TAGS))
                else -> BulkTags(tags)
            }
        }
    }
}
