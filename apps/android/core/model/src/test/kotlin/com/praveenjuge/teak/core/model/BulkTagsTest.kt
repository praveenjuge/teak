package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals

/** Runs the rows in `bulkTags.json`, which the backend's `normalizeBulkTags` test and Apple's `BulkTags` run too. */
class BulkTagsTest {
    @Serializable
    private data class Row(val text: String, val tags: List<String>, val error: String?)

    @Serializable
    private data class Rows(val rows: List<Row>)

    private fun code(parsed: BulkTags): String? = when (val key = (parsed.error as UiText.Message?)?.key) {
        null -> if (parsed.tags.isEmpty()) "EMPTY" else null
        "errors.tags.NAME_TOO_LONG" -> "NAME_TOO_LONG"
        "native.bulk.tooManyTags" -> "TOO_MANY_TAGS"
        else -> key
    }

    @Test
    fun `takes the tags the backend takes`() {
        for (row in Fixtures.load<Rows>("bulkTags").rows) {
            val parsed = BulkTags.parse(row.text)
            assertEquals(row.tags, parsed.tags, row.text)
            assertEquals(row.error, code(parsed), row.text)
            assertEquals(row.error == null, parsed.canAdd, row.text)
        }
    }
}
