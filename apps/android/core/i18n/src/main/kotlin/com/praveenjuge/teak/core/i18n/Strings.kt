package com.praveenjuge.teak.core.i18n

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import com.praveenjuge.teak.core.model.UiText

/**
 * Teak's text for a catalog key, in the app's language: `tr("native.library.title")`.
 * The resources come from `packages/i18n` through `apps/android/scripts/i18n.ts`.
 * A message with a plural takes its [count]; [args] fill the other placeholders, in the
 * order the English message first uses them.
 */
fun Resources.tr(key: String, vararg args: Any, count: Int? = null): String {
    val values = buildList {
        count?.let(::add)
        args.forEach { add(if (it is UiText) text(it) else it) }
    }.toTypedArray()
    Catalog.plurals[key]?.let { id ->
        return getQuantityString(id, requireNotNull(count) { "$key needs a count" }, *values)
    }
    val id = Catalog.strings[key] ?: return key
    return if (values.isEmpty()) getString(id) else getString(id, *values)
}

fun Resources.text(text: UiText): String = when (text) {
    is UiText.Message -> tr(text.key, *text.args.toTypedArray(), count = text.count)
    is UiText.Verbatim -> text.text
}

@Composable
@ReadOnlyComposable
fun tr(key: String, vararg args: Any, count: Int? = null): String {
    // Reading the configuration recomposes this text when the language changes.
    LocalConfiguration.current
    return LocalContext.current.resources.tr(key, *args, count = count)
}

@Composable
@ReadOnlyComposable
fun UiText.resolve(): String {
    LocalConfiguration.current
    return LocalContext.current.resources.text(this)
}
