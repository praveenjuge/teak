package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PaletteEditTest {
    private fun palette(vararg hexes: String, deleted: Boolean = false) = Card(
        id = "p1",
        creationTime = 0.0,
        type = CardType.Palette,
        colors = hexes.map { CardColor(it) },
        isDeleted = deleted.takeIf { it },
    )

    @Test
    fun `reads a typed hex code as #RRGGBB`() {
        assertEquals("#FF5500", PaletteEdit.normalizedHex("#ff5500"))
        assertEquals("#FF5500", PaletteEdit.normalizedHex("  F50 "))
        assertEquals("#4ECDC4", PaletteEdit.normalizedHex("4ecdc4"))
    }

    @Test
    fun `anything else is not a hex code`() {
        for (input in listOf("rgb(1, 2, 3)", "red", "#ff550080", "#ff55", "", "##fff")) {
            assertNull(PaletteEdit.normalizedHex(input), input)
        }
    }

    @Test
    fun `adds to a palette outside Trash with room`() {
        assertTrue(PaletteEdit.canAdd(palette("#FF5500")))
        assertTrue(PaletteEdit.canAdd(palette(*Array(11) { "#%06X".format(it) })))
        assertFalse(PaletteEdit.canAdd(palette(*Array(PaletteEdit.MAX_COLORS) { "#%06X".format(it) })))
        assertFalse(PaletteEdit.canAdd(palette("#FF5500", deleted = true)))
        assertFalse(PaletteEdit.canAdd(palette("#FF5500").copy(type = CardType.Image)))
    }

    @Test
    fun `removes only while another color stays`() {
        assertTrue(PaletteEdit.canRemove(palette("#FF5500", "#4ECDC4")))
        assertFalse(PaletteEdit.canRemove(palette("#FF5500")))
        // Removing takes every copy, so one color saved twice can't be removed either.
        assertFalse(PaletteEdit.canRemove(palette("#ff5500", "#FF5500")))
        assertFalse(PaletteEdit.canRemove(palette("#FF5500", "#4ECDC4", deleted = true)))
        assertFalse(PaletteEdit.canRemove(palette("#FF5500", "#4ECDC4").copy(type = CardType.Text)))
    }

    @Test
    fun `finds a color however it's written`() {
        val card = palette("#ff5500", "#4ECDC4")
        assertTrue(PaletteEdit.contains(card, "F50"))
        assertTrue(PaletteEdit.contains(card, "#4ecdc4"))
        assertFalse(PaletteEdit.contains(card, "#000000"))
        assertFalse(PaletteEdit.contains(card, "red"))
    }

    @Test
    fun `color edits send one hex code`() {
        assertEquals(
            mapOf("cardId" to "p1", "field" to "addColor", "value" to "#FF5500"),
            CardFieldChange.AddColor("#FF5500").args("p1"),
        )
        assertEquals(
            mapOf("cardId" to "p1", "field" to "removeColor", "value" to "#4ECDC4"),
            CardFieldChange.RemoveColor("#4ECDC4").args("p1"),
        )
    }
}
