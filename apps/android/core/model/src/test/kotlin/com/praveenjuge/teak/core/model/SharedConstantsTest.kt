package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class SharedConstantsTest {
    @Test
    fun `card types match the backend's`() {
        assertEquals(CARD_TYPES, CardType.entries.map { it.wireName })
    }

    @Test
    fun `color hues match the backend's buckets and each has a swatch`() {
        assertEquals(COLOR_HUE_BUCKETS, ColorHue.entries.map { it.wireName })
        assertEquals(COLOR_HUE_BUCKETS.toSet(), COLOR_HUE_SWATCHES.keys)
        assertEquals(0xFF3B82F6, ColorHue.Blue.hex)
    }

    @Test
    fun `every bulk action is one the backend takes`() {
        BulkAction.entries.forEach { assertTrue(it.wireName in BULK_CARD_ACTIONS, it.wireName) }
    }

    @Test
    fun `every is value has its words`() {
        SearchIsValue.entries.forEach { assertNotNull(SEARCH_IS_WORDS[it.wire], it.wire) }
        assertEquals(SearchIsValue.entries.map { it.wire }.toSet(), SEARCH_IS_WORDS.keys)
    }

    @Test
    fun `type aliases name real card types`() {
        CARD_TYPE_ALIASES.values.forEach { assertNotNull(CardType.fromWire(it), it) }
    }
}
