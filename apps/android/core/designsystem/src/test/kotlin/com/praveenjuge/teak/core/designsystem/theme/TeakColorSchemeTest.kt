package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class TeakColorSchemeTest {
    private val wallpaper = lightColorScheme(primary = Color(0xFF3366FF))
    private val asked = mutableListOf<Boolean>()
    private val dynamic = { dark: Boolean ->
        asked += dark
        wallpaper
    }

    @Test
    fun `Teak's red is the default in light and dark`() {
        assertSame(lightScheme, teakColorScheme(darkTheme = false, wallpaperColors = false, dynamic = dynamic))
        assertSame(darkScheme, teakColorScheme(darkTheme = true, wallpaperColors = false, dynamic = dynamic))
        assertEquals(emptyList(), asked)
    }

    @Test
    fun `wallpaper colors use the dynamic scheme for the current theme`() {
        assertSame(wallpaper, teakColorScheme(darkTheme = false, wallpaperColors = true, dynamic = dynamic))
        assertSame(wallpaper, teakColorScheme(darkTheme = true, wallpaperColors = true, dynamic = dynamic))
        assertEquals(listOf(false, true), asked)
    }
}
