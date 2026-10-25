package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

@Serializable
data class LinkPrice(val amount: Double, val currency: String? = null)

/** Every sentence for one done verb, one catalog key each: the web words these with a select, which native text can't use. */
data class DoneWords(val markAs: UiText, val markAsNot: UiText, val state: UiText, val markedAs: UiText, val markedAsNot: UiText)

/** Ports of `doneActionLabel` (`shared/linkCategories.ts`) and `formatLinkPrice` (`shared/price.ts`). */
object LinkState {
    private val actionable = ACTIONABLE_LINK_CATEGORIES.toSet()

    /** The verb for marking a link done: "read" for an article, "watched" for a film, "done" otherwise. */
    fun doneVerb(category: String?): String = category?.let(LINK_CATEGORY_DONE_VERBS::get) ?: "done"

    /** Whether `is:todo` lists links of this category; it doesn't change the done label. */
    fun isActionable(category: String?): Boolean = category != null && category in actionable

    /** The sentences for [verb], or null for a verb this list doesn't know yet. */
    fun words(verb: String): DoneWords? = when (verb) {
        "read" -> DoneWords(
            UiText.of("native.done.markAs.read"), UiText.of("native.done.markAsNot.read"), UiText.of("native.done.state.read"),
            UiText.of("native.done.markedAs.read"), UiText.of("native.done.markedAsNot.read"),
        )
        "watched" -> DoneWords(
            UiText.of("native.done.markAs.watched"), UiText.of("native.done.markAsNot.watched"), UiText.of("native.done.state.watched"),
            UiText.of("native.done.markedAs.watched"), UiText.of("native.done.markedAsNot.watched"),
        )
        "listened" -> DoneWords(
            UiText.of("native.done.markAs.listened"), UiText.of("native.done.markAsNot.listened"), UiText.of("native.done.state.listened"),
            UiText.of("native.done.markedAs.listened"), UiText.of("native.done.markedAsNot.listened"),
        )
        "bought" -> DoneWords(
            UiText.of("native.done.markAs.bought"), UiText.of("native.done.markAsNot.bought"), UiText.of("native.done.state.bought"),
            UiText.of("native.done.markedAs.bought"), UiText.of("native.done.markedAsNot.bought"),
        )
        "cooked" -> DoneWords(
            UiText.of("native.done.markAs.cooked"), UiText.of("native.done.markAsNot.cooked"), UiText.of("native.done.state.cooked"),
            UiText.of("native.done.markedAs.cooked"), UiText.of("native.done.markedAsNot.cooked"),
        )
        "played" -> DoneWords(
            UiText.of("native.done.markAs.played"), UiText.of("native.done.markAsNot.played"), UiText.of("native.done.state.played"),
            UiText.of("native.done.markedAs.played"), UiText.of("native.done.markedAsNot.played"),
        )
        "done" -> DoneWords(
            UiText.of("native.done.markAs.done"), UiText.of("native.done.markAsNot.done"), UiText.of("native.done.state.done"),
            UiText.of("native.done.markedAs.done"), UiText.of("native.done.markedAsNot.done"),
        )
        else -> null
    }

    private fun wordsFor(category: String?): DoneWords = words(doneVerb(category)) ?: requireNotNull(words("done"))

    /** The done toggle's label, as the web's `doneActionLabel` words it: "Mark as read" before, "Read" after. */
    fun toggleText(category: String?, isDone: Boolean): UiText = wordsFor(category).let { if (isDone) it.state else it.markAs }

    /** The note after toggling, also the tile badge's spoken label: "Marked as read" or "Marked as not read". */
    fun toggledText(category: String?, isDone: Boolean): UiText = wordsFor(category).let { if (isDone) it.markedAs else it.markedAsNot }

    /** English only, for screens that haven't moved to [toggledText] yet. */
    fun toggledMessage(category: String?, isDone: Boolean): String {
        val verb = doneVerb(category)
        return if (isDone) "Marked as $verb" else "Marked as not $verb"
    }

    /** [formatPrice] in the app's language: "Free" comes from the catalog. */
    fun priceText(price: LinkPrice, locale: Locale = Locale.getDefault()): UiText =
        if (price.amount == 0.0) UiText.of("native.details.free") else UiText.verbatim(formatPrice(price, locale))

    fun formatPrice(price: LinkPrice, locale: Locale = Locale.getDefault()): String {
        if (price.amount == 0.0) return "Free"
        val currency = price.currency?.let { runCatching { Currency.getInstance(it) }.getOrNull() }
        if (currency != null) {
            return NumberFormat.getCurrencyInstance(locale).apply {
                this.currency = currency
                val digits = currency.defaultFractionDigits.coerceAtLeast(0)
                minimumFractionDigits = digits
                maximumFractionDigits = digits
            }.format(price.amount)
        }
        return NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 }.format(price.amount)
    }
}
