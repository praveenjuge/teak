package com.praveenjuge.teak.core.data.repository

import android.app.LocaleManager
import android.content.Context
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import com.praveenjuge.teak.core.data.FakeConvexApi
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.i18n.AppLanguage
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ConvexLanguageRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val convex = FakeConvexApi()

    @Test
    fun `a system language that can't be saved yet stays pending and wins over the account`() = runTest {
        AppLanguage.apply(context, "en")
        convex.responses["settings/preferences:getPreferences"] = { buildJsonObject { put("locale", "en") } }
        // Settings → Apps → Teak → Language → Français.
        context.getSystemService(LocaleManager::class.java).applicationLocales = LocaleList.forLanguageTags("fr")
        convex.responses["settings/preferences:setLocale"] = { throw TeakException(null, "offline") }

        val repository = ConvexLanguageRepository(context, convex)
        repository.follow()
        assertEquals("fr", repository.current.value)
        assertEquals("fr", AppLanguage.systemChoice(context))

        convex.responses["settings/preferences:setLocale"] = { buildJsonObject { put("locale", JsonPrimitive("fr")) } }
        repository.follow()
        assertEquals("fr", repository.current.value)
        assertNull(AppLanguage.systemChoice(context))
        assertEquals(
            mapOf("locale" to "fr"),
            convex.calls.last { it.name == "settings/preferences:setLocale" }.args,
        )
    }
}
