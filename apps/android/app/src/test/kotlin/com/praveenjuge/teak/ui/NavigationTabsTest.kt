package com.praveenjuge.teak.ui

import androidx.window.core.layout.WindowSizeClass
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationTabsTest {
    @Test
    fun `phones and narrow windows keep the four tabs`() {
        val four = listOf(Tab.Home, Tab.Folders, Tab.Add, Tab.Settings)
        assertEquals(four, navigationTabs(WindowWidth.Compact))
        assertEquals(four, navigationTabs(WindowWidth.Medium))
    }

    @Test
    fun `wide windows add Favorites, Archive and Trash to the rail`() {
        assertEquals(
            listOf(Tab.Home, Tab.Favorites, Tab.Archive, Tab.Trash, Tab.Folders, Tab.Add, Tab.Settings),
            navigationTabs(WindowWidth.Expanded),
        )
    }

    @Test
    fun `width classes follow Material's breakpoints`() {
        assertEquals(WindowWidth.Compact, WindowSizeClass(minWidthDp = 0, minHeightDp = 0).windowWidth())
        assertEquals(WindowWidth.Medium, WindowSizeClass(minWidthDp = 600, minHeightDp = 900).windowWidth())
        assertEquals(WindowWidth.Expanded, WindowSizeClass(minWidthDp = 840, minHeightDp = 480).windowWidth())
    }
}
