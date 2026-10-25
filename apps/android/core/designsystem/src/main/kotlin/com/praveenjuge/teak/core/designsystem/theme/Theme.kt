package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Teak's red schemes, or the wallpaper's (Material You) when [wallpaperColors] is on. minSdk is 31,
 * so dynamic color is always there. [dynamic] builds the wallpaper scheme for a dark or light theme.
 */
fun teakColorScheme(darkTheme: Boolean, wallpaperColors: Boolean, dynamic: (dark: Boolean) -> ColorScheme): ColorScheme = when {
    wallpaperColors -> dynamic(darkTheme)
    darkTheme -> darkScheme
    else -> lightScheme
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TeakTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    wallpaperColors: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = teakColorScheme(darkTheme, wallpaperColors) { dark ->
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    }
    MaterialExpressiveTheme(
        colorScheme = colorScheme,
        motionScheme = MotionScheme.expressive(),
        typography = TeakTypography,
        content = content,
    )
}
