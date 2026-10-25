package com.praveenjuge.teak.core.i18n

import android.content.res.Configuration
import android.content.res.Resources
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import com.praveenjuge.teak.core.model.UiText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Apple's LocalizationTests check the same cases.
@RunWith(RobolectricTestRunner::class)
class StringsTest {
    private fun resources(code: String): Resources {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocales(LocaleList.forLanguageTags(code))
        return context.createConfigurationContext(configuration).resources
    }

    @Test
    fun pluralsFollowTheLanguage() {
        val cases = listOf(
            Triple("en", 1, "1 card"), Triple("en", 2, "2 cards"),
            Triple("de", 1, "1 Karte"), Triple("de", 3, "3 Karten"),
            Triple("ja", 1, "1 枚のカード"), Triple("ja", 3, "3 枚のカード"),
        )
        for ((code, count, expected) in cases) {
            assertEquals(expected, resources(code).tr("native.common.cardCount", count = count))
        }
    }

    @Test
    fun placeholdersTakeValues() {
        assertEquals(
            "A tag named \"Design\" already exists. Merge into it instead.",
            resources("en").tr("errors.tags.TAG_EXISTS", "Design"),
        )
        assertTrue(resources("de").tr("errors.folders.NAME_TOO_LONG", 80).contains("80"))
    }

    @Test
    fun everyLanguageHasItsOwnText() {
        val texts = AppLanguage.codes.map { resources(it).tr("settings.language.changed") }.toSet()
        assertEquals(AppLanguage.codes.size, texts.size)
    }

    @Test
    fun uiTextResolvesNestedText() {
        val text = UiText.of("errors.tags.TAG_EXISTS", UiText.of("cards.types.link"))
        assertEquals("A tag named \"Link\" already exists. Merge into it instead.", resources("en").text(text))
        assertEquals("Design", resources("fr").text(UiText.verbatim("Design")))
    }

    @Test
    fun unknownKeysShowTheKey() {
        assertEquals("native.missing.key", resources("fr").tr("native.missing.key"))
    }

    @Test
    fun theSettingListsTeaksLanguages() {
        assertEquals(listOf("en", "es", "pt-BR", "de", "fr", "ja", "ko", "zh-Hans"), AppLanguage.codes)
        assertEquals("pt-BR", AppLanguage.match(LocaleList.forLanguageTags("pt-BR,en")))
        assertEquals("zh-Hans", AppLanguage.match(LocaleList.forLanguageTags("zh-CN")))
        assertEquals("de", AppLanguage.match(LocaleList.forLanguageTags("de-AT")))
        assertEquals("pt-BR", AppLanguage.match(LocaleList.forLanguageTags("pt-PT")))
        assertEquals("ja", AppLanguage.match(LocaleList.forLanguageTags("zh-TW,ja")))
        assertEquals("en", AppLanguage.match(LocaleList.forLanguageTags("sv-SE")))
    }
}
