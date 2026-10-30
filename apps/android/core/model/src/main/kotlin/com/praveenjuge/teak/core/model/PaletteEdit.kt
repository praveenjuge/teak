package com.praveenjuge.teak.core.model

/** Adding and removing a palette card's colors, as Apple's `PaletteEdit`. The server checks the same rules. */
object PaletteEdit {
    /** The most colors a palette holds once a color is added (the server's `MAX_PALETTE_COLORS`). */
    const val MAX_COLORS = 12

    private val hexCode = Regex("^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

    /** A typed hex code (`#RGB` or `#RRGGBB`, with or without the `#`) as `#RRGGBB`, or null when it isn't one. */
    fun normalizedHex(input: String): String? {
        val digits = hexCode.matchEntire(input.trim())?.groupValues?.get(1) ?: return null
        val full = if (digits.length == 3) digits.map { "$it$it" }.joinToString("") else digits
        return "#" + full.uppercase()
    }

    /** A palette outside Trash with room for another color. */
    fun canAdd(card: Card): Boolean = isEditable(card) && card.colors.orEmpty().size < MAX_COLORS

    /** A palette outside Trash that keeps a color after one is removed (removing takes every copy of it). */
    fun canRemove(card: Card): Boolean = isEditable(card) && distinctHexes(card).size > 1

    fun contains(card: Card, hex: String): Boolean {
        val key = normalizedHex(hex) ?: return false
        return key in distinctHexes(card)
    }

    /** A stored color's `#RRGGBB`, ignoring any alpha, as the server compares them. */
    fun storedHex(color: CardColor): String? {
        val digits = color.hex.trim().removePrefix("#")
        return normalizedHex(if (digits.length == 8) digits.take(6) else digits)
    }

    private fun isEditable(card: Card): Boolean = card.type == CardType.Palette && !card.deleted

    private fun distinctHexes(card: Card): Set<String> = card.colors.orEmpty().mapNotNull(::storedHex).toSet()
}
