package com.praveenjuge.teak.core.i18n

import android.app.LocaleManager
import android.icu.util.ULocale
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import androidx.core.content.edit
import com.praveenjuge.teak.core.model.LOCALE_NAMES

/**
 * The language Teak's own text is in: the account's Language setting, or the system's language
 * for the app while signed out. Android 13 and later keep it as the per-app language, which
 * Settings → Apps → Teak → Language also changes. Android 12 has no per-app language, so the
 * app keeps the choice and [wrap] applies it to each activity.
 */
object AppLanguage {
    /** Teak's languages, in the order the Language setting lists them. */
    val codes: List<String> = LOCALE_NAMES.keys.toList()

    private const val PREFS = "teak_language"
    private const val CHOSEN = "chosen"
    private const val APPLIED = "applied"
    private const val PENDING = "pending"

    /** The language the app shows now. */
    fun current(context: Context): String = chosen(context) ?: match(systemLocales())

    /**
     * Shows the app in [code]. Android 13 and later recreate the activity in the new language;
     * on Android 12 the caller recreates it.
     */
    fun apply(context: Context, code: String) {
        if (code !in codes) return
        prefs(context).edit {
            putString(CHOSEN, code)
            putString(APPLIED, code)
            remove(PENDING)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.getSystemService(LocaleManager::class.java).applicationLocales = LocaleList.forLanguageTags(code)
        }
    }

    /**
     * A language picked in the system's per-app list that the account hasn't taken yet, or null.
     * It stays pending until [systemChoiceSaved], so a failed save is retried rather than lost.
     * Picking "System default" there counts as the device's language.
     */
    fun systemChoice(context: Context): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val applied = prefs(context).getString(APPLIED, null)
            val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
            val now = if (locales.isEmpty) match(systemLocales()) else match(locales)
            if (applied != null && now != applied) {
                prefs(context).edit {
                    putString(CHOSEN, now)
                    putString(APPLIED, now)
                    putString(PENDING, now)
                }
            }
        }
        return prefs(context).getString(PENDING, null)?.takeIf { it in codes }
    }

    /** The account took the system's choice. */
    fun systemChoiceSaved(context: Context) {
        prefs(context).edit { remove(PENDING) }
    }

    /**
     * Resources in the app's language for code outside an activity: workers, notifications and
     * launcher shortcuts. Android 13 and later apply the per-app language to the whole process;
     * Android 12 only to activities that [wrap] their context.
     */
    fun resources(context: Context): Resources = wrap(context).resources

    /** On Android 12, a context in the chosen language for an activity's `attachBaseContext`. */
    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return base
        val code = prefs(base).getString(CHOSEN, null) ?: return base
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList.forLanguageTags(code))
        return base.createConfigurationContext(configuration)
    }

    private fun chosen(context: Context): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val locales = context.getSystemService(LocaleManager::class.java).applicationLocales
            return if (locales.isEmpty) null else match(locales)
        }
        return prefs(context).getString(CHOSEN, null)?.takeIf { it in codes }
    }

    /** The device's languages, which a per-app language doesn't change. */
    private fun systemLocales(): LocaleList = Resources.getSystem().configuration.locales

    /**
     * The first of [locales] Teak speaks, else English. A language matches in the same script and
     * any region: Portuguese (Portugal) gets pt-BR, and Chinese (Taiwan) doesn't get zh-Hans.
     */
    fun match(locales: LocaleList): String {
        for (index in 0 until locales.size()) {
            val wanted = ULocale.addLikelySubtags(ULocale.forLocale(locales[index]))
            codes.firstOrNull { code ->
                val have = ULocale.addLikelySubtags(ULocale.forLanguageTag(code))
                have.language == wanted.language && have.script == wanted.script
            }?.let { return it }
        }
        return "en"
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
