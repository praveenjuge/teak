package com.praveenjuge.teak.core.data.repository

import android.content.Context
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.i18n.AppLanguage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The app's language, which follows the account's Language setting as the web does. A language
 * picked in Android's per-app list (Settings → Apps → Teak → Language) is saved to the account.
 */
interface LanguageRepository {
    /** The language the app shows now, a BCP 47 code. */
    val current: StateFlow<String>

    /** Shows the app in [code] now and saves it to the account; switches back and throws if saving fails. */
    suspend fun choose(code: String)

    /** Follows the account's language until cancelled. */
    suspend fun follow()
}

@Singleton
class ConvexLanguageRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val convex: ConvexApi,
) : LanguageRepository {
    private val _current = MutableStateFlow(AppLanguage.current(context))
    override val current: StateFlow<String> = _current.asStateFlow()

    // The account's value last acted on, so a save still in flight is never undone.
    private var lastSeen: String? = null

    override suspend fun choose(code: String) {
        val previous = _current.value
        if (code == previous) return
        apply(code)
        try {
            save(code)
        } catch (error: Exception) {
            apply(previous)
            throw error
        }
    }

    override suspend fun follow() {
        AppLanguage.systemChoice(context)?.let { _current.value = it }
        convex.subscribe(ConvexFunctions.getPreferences).collect { result ->
            val code = result.getOrNull()?.locale?.takeIf { it in AppLanguage.codes } ?: return@collect
            // A language picked in the system's list wins until the account has it; each update retries.
            AppLanguage.systemChoice(context)?.let { picked ->
                if (code == picked || catchingFailures { save(picked) }.isSuccess) {
                    AppLanguage.systemChoiceSaved(context)
                    lastSeen = picked
                }
                return@collect
            }
            if (code == lastSeen) return@collect
            lastSeen = code
            if (code != _current.value) apply(code)
        }
    }

    private suspend fun save(code: String) {
        convex.mutation(ConvexFunctions.setLocale, mapOf("locale" to code))
        lastSeen = code
    }

    private fun apply(code: String) {
        AppLanguage.apply(context, code)
        _current.value = code
    }
}
