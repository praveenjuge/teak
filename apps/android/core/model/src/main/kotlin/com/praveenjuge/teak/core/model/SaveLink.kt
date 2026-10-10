package com.praveenjuge.teak.core.model

import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/**
 * Reads the text from a `teak://save?text=…` link, straight from the raw URL, so a `#`, `&` or `%`
 * inside the text survives exactly as the automation app sent it. Matches iOS's `textFromSaveLink`.
 */
object SaveLink {
    fun text(url: String?): String {
        if (url == null) return ""
        val queryStart = url.indexOf('?')
        if (queryStart == -1) return ""
        val hashStart = url.indexOf('#', queryStart)
        val query = url.substring(queryStart + 1, if (hashStart == -1) url.length else hashStart)
        for (pair in query.split('&')) {
            val separator = pair.indexOf('=')
            val key = if (separator == -1) pair else pair.substring(0, separator)
            if (key != "text") continue
            val value = if (separator == -1) "" else pair.substring(separator + 1)
            return try {
                // URLDecoder already turns + into a space; it rejects malformed escapes like %E0%A4%A.
                strictDecode(value).trim()
            } catch (_: IllegalArgumentException) {
                ""
            }
        }
        return ""
    }

    private fun strictDecode(value: String): String {
        val decoded = URLDecoder.decode(value, StandardCharsets.UTF_8)
        // URLDecoder replaces invalid UTF-8 with U+FFFD where JavaScript's decodeURIComponent throws.
        require('�' !in decoded || '�' in value) { "Malformed UTF-8" }
        return decoded
    }
}
