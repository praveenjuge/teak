package com.praveenjuge.teak.core.model

/** "#RGB", "#RRGGBB" or "#RRGGBBAA" (CSS order) as a 0xAARRGGBB value, or null. */
fun parseHexArgb(value: String): Long? {
    val hex = value.trim().removePrefix("#")
    val rgba = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("") + "ff"
        6 -> hex + "ff"
        8 -> hex
        else -> return null
    }
    return rgba.toLongOrNull(16)?.let(::rgbaToArgb)
}

private fun rgbaToArgb(rgba: Long): Long = ((rgba and 0xFF) shl 24) or (rgba shr 8)
