package com.praveenjuge.teak.core.i18n

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class AppLanguageTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    // Android 12 has no per-app language, so workers and shortcuts read the app's own choice.
    @Test
    @Config(sdk = [32])
    fun codeOutsideAnActivityReadsTheChosenLanguageOnAndroid12() {
        AppLanguage.apply(context, "de")
        assertEquals("Sprache geändert", AppLanguage.resources(context).tr("settings.language.changed"))
        assertEquals("de", AppLanguage.current(context))
    }
}
