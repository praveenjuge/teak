package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.prefs.PreferencesRepository
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import kotlinx.coroutines.flow.MutableStateFlow

class FakePreferencesRepository : PreferencesRepository {
    override val theme = MutableStateFlow(ThemePreference.System)
    private var authMode: String? = null
    override suspend fun setTheme(theme: ThemePreference) {
        this.theme.value = theme
    }
    override suspend fun cachedAuthMode(): String? = authMode
    override suspend fun cacheAuthMode(json: String) {
        authMode = json
    }
}
