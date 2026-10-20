package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

@Serializable
data class LinkPrice(val amount: Double, val currency: String? = null)

/** Ports of `doneActionLabel` (`shared/linkCategories.ts`) and `formatLinkPrice` (`shared/price.ts`). */
object LinkState {
    private val actionable = ACTIONABLE_LINK_CATEGORIES.toSet()

    /** The verb for marking a link done: "read" for an article, "watched" for a film, "done" otherwise. */
    fun doneVerb(category: String?): String = category?.let(LINK_CATEGORY_DONE_VERBS::get) ?: "done"

    /** Whether `is:todo` lists links of this category; it doesn't change the done label. */
    fun isActionable(category: String?): Boolean = category != null && category in actionable

    /** The done toggle's label, as the web's `doneActionLabel` words it: "Mark as read" before, "Read" after. */
    fun toggleLabel(category: String?, isDone: Boolean): String {
        val verb = doneVerb(category)
        return if (isDone) verb.replaceFirstChar(Char::uppercaseChar) else "Mark as $verb"
    }

    /** The note after toggling, also the tile badge's spoken label: "Marked as read" or "Marked as not read". */
    fun toggledMessage(category: String?, isDone: Boolean): String {
        val verb = doneVerb(category)
        return if (isDone) "Marked as $verb" else "Marked as not $verb"
    }

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
