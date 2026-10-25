package com.praveenjuge.teak.core.model

/**
 * Text for a person to read, resolved in the app's language where it's shown (`core:i18n`).
 * Logic and ViewModels return this instead of a `String`, since they can't read resources.
 */
sealed interface UiText {
    /**
     * A catalog key from `packages/i18n`, such as `native.library.title`. A message with a plural
     * takes its [count]; [args] fill the other placeholders, in the order the English message first
     * uses them. An arg may itself be a [UiText].
     */
    data class Message(val key: String, val count: Int? = null, val args: List<Any> = emptyList()) : UiText

    /** Text that isn't Teak's own, such as a card's title or a server message, shown as it is. */
    data class Verbatim(val text: String) : UiText

    companion object {
        fun of(key: String, vararg args: Any, count: Int? = null): UiText = Message(key, count, args.toList())

        fun verbatim(text: String): UiText = Verbatim(text)
    }
}
