package com.praveenjuge.teak.core.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

enum class ThemePreference { System, Light, Dark }

interface PreferencesRepository {
    val theme: Flow<ThemePreference>
    suspend fun setTheme(theme: ThemePreference)

    /** The last `auth:getAuthMode` result, so sign-in works before the socket connects. */
    suspend fun cachedAuthMode(): String?
    suspend fun cacheAuthMode(json: String)
}

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "teak_preferences")

@Singleton
class DataStorePreferencesRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) : PreferencesRepository {
    private val themeKey = stringPreferencesKey("theme")
    private val authModeKey = stringPreferencesKey("auth_mode")

    private val data: Flow<Preferences> = context.dataStore.data.catch { error ->
        if (error is IOException) emit(androidx.datastore.preferences.core.emptyPreferences()) else throw error
    }

    override val theme: Flow<ThemePreference> = data.map { prefs ->
        prefs[themeKey]?.let { runCatching { ThemePreference.valueOf(it) }.getOrNull() } ?: ThemePreference.System
    }

    override suspend fun setTheme(theme: ThemePreference) {
        context.dataStore.edit { prefs ->
            if (theme == ThemePreference.System) prefs.remove(themeKey) else prefs[themeKey] = theme.name
        }
    }

    override suspend fun cachedAuthMode(): String? = data.first()[authModeKey]

    override suspend fun cacheAuthMode(json: String) {
        if (json.length > 4096) return
        context.dataStore.edit { it[authModeKey] = json }
    }
}
