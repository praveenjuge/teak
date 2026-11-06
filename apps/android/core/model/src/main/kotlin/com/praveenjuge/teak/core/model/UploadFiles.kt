package com.praveenjuge.teak.core.model

/** The name and type an upload is sent with, so the backend takes it (`packages/convex/shared/fileFormats.ts`). */
object UploadFiles {
    private val SEPARATORS = Regex("[/\\\\]+")
    private val CONTROL = Regex("[\\u0000-\\u001F\\u007F]")
    private const val MAX_EXTENSION_LENGTH = 16

    /** What Android's content resolvers report for a file they can't type, beside the backend's own generic types. */
    private val RESOLVER_PLACEHOLDERS = setOf("application/unknown", "*/*")

    fun normalizeMimeType(value: String?): String = value?.substringBefore(';')?.trim()?.lowercase().orEmpty()

    fun isGenericMimeType(value: String?): Boolean =
        normalizeMimeType(value).let { it in GENERIC_MIME_TYPES || it in RESOLVER_PLACEHOLDERS }

    /** The type a resolver [reported], or the one the file's name implies when the report says nothing. */
    fun mimeType(reported: String?, fromName: String?): String =
        reported?.takeUnless(::isGenericMimeType) ?: fromName ?: reported?.takeIf(String::isNotBlank) ?: "application/octet-stream"

    /** Port of `validateFileName`: the trimmed name, or null when the backend would refuse it. */
    fun validName(name: String): String? {
        val trimmed = name.trim()
        val refused = trimmed.isEmpty() || trimmed.length > MAX_FILE_NAME_LENGTH || trimmed == "." || trimmed == ".." ||
            '/' in trimmed || '\\' in trimmed || CONTROL.containsMatchIn(trimmed)
        return trimmed.takeUnless { refused }
    }

    /**
     * [name] made into one the backend takes: path separators and control characters become "_", and a name
     * past [MAX_FILE_NAME_LENGTH] is shortened before its extension. [fallback] when nothing usable is left.
     */
    fun safeName(name: String, fallback: String): String {
        val cleaned = name.replace(SEPARATORS, "_").replace(CONTROL, "_").trim()
        return validName(fit(cleaned)) ?: fallback
    }

    private fun fit(name: String): String {
        if (name.length <= MAX_FILE_NAME_LENGTH) return name
        val extension = name.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= MAX_EXTENSION_LENGTH }
        val room = MAX_FILE_NAME_LENGTH - (extension?.let { it.length + 1 } ?: 0)
        var base = name.take(room)
        if (base.lastOrNull()?.isHighSurrogate() == true) base = base.dropLast(1)
        return base.trimEnd() + extension?.let { ".$it" }.orEmpty()
    }
}
