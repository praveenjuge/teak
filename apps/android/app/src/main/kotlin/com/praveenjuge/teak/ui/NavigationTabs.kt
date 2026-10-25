package com.praveenjuge.teak.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.window.core.layout.WindowSizeClass
import com.praveenjuge.teak.core.i18n.tr

internal enum class Tab(val selected: ImageVector, val unselected: ImageVector) {
    Home(Icons.Filled.Home, Icons.Outlined.Home),
    Favorites(Icons.Filled.Favorite, Icons.Outlined.FavoriteBorder),
    Archive(Icons.Filled.Archive, Icons.Outlined.Archive),
    Trash(Icons.Filled.Delete, Icons.Outlined.Delete),
    Folders(Icons.Filled.Folder, Icons.Outlined.Folder),
    Add(Icons.Filled.AddCircle, Icons.Outlined.AddCircleOutline),
    Settings(Icons.Filled.Settings, Icons.Outlined.Settings),
}

/** The window's width, in Material's size classes. */
internal enum class WindowWidth { Compact, Medium, Expanded }

internal fun WindowSizeClass.windowWidth(): WindowWidth = when {
    isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_EXPANDED_LOWER_BOUND) -> WindowWidth.Expanded
    isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND) -> WindowWidth.Medium
    else -> WindowWidth.Compact
}

/**
 * The navigation items for a window width. Wide windows give Favorites, Archive and Trash their own
 * rail items, in place of the library's chips; phones and narrow windows keep the four tabs.
 */
internal fun navigationTabs(width: WindowWidth): List<Tab> = when (width) {
    WindowWidth.Expanded -> Tab.entries
    WindowWidth.Compact, WindowWidth.Medium -> listOf(Tab.Home, Tab.Folders, Tab.Add, Tab.Settings)
}

@Composable
internal fun Tab.label(): String = when (this) {
    Tab.Home -> tr("native.filters.home")
    Tab.Favorites -> tr("native.filters.favorites")
    Tab.Archive -> tr("native.filters.archive")
    Tab.Trash -> tr("native.filters.trash")
    Tab.Folders -> tr("native.folders.title")
    Tab.Add -> tr("native.app.nav.add")
    Tab.Settings -> tr("native.settings.title")
}
