package com.praveenjuge.teak.core.model

import java.net.IDN

/** A port of `normalizeUrlHost` and `hostForDisplay` in `packages/convex/shared/utils/urlHost.ts`. */
object UrlHost {
    private val OPAQUE_SCHEME = Regex("^[a-z][a-z\\d+.-]*:(?!//)(?!\\d)", RegexOption.IGNORE_CASE)
    private val HAS_SCHEME = Regex("^[a-z][a-z\\d+.-]*://", RegexOption.IGNORE_CASE)
    private val FORBIDDEN = Regex("[\\s<>^|%\\u0000]")

    /** The lowercase host without `www.` or a port (punycode for Unicode names), or null when there's none. */
    fun normalize(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isEmpty() || OPAQUE_SCHEME.containsMatchIn(trimmed)) return null
        val withScheme = if (HAS_SCHEME.containsMatchIn(trimmed)) trimmed else "http://$trimmed"
        var host = hostOf(withScheme) ?: return null
        while (host.endsWith(".")) host = host.dropLast(1)
        if (host.startsWith("www.") && host.length > 4) host = host.substring(4)
        return host.ifEmpty { null }
    }

    private fun hostOf(url: String): String? {
        val afterScheme = url.substringAfter("://")
        val authority = afterScheme.takeWhile { it != '/' && it != '?' && it != '#' && it != '\\' }.substringAfterLast('@')
        val raw = if (authority.startsWith("[")) {
            val close = authority.indexOf(']')
            if (close < 0) return null
            val inside = authority.substring(1, close)
            if (inside.isEmpty() || !inside.all { it.isLetterOrDigit() || it == ':' || it == '.' }) return null
            return "[${inside.lowercase()}]"
        } else {
            authority.substringBefore(':')
        }
        if (raw.isEmpty() || FORBIDDEN.containsMatchIn(raw)) return null
        return try {
            IDN.toASCII(raw.lowercase(), IDN.ALLOW_UNASSIGNED).lowercase()
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** Punycode labels written back in Unicode, for chips and rows. */
    fun forDisplay(host: String): String =
        host.split(".").joinToString(".") { label ->
            if (label.startsWith("xn--")) IDN.toUnicode(label, IDN.ALLOW_UNASSIGNED).takeIf { it != label } ?: label else label
        }
}
