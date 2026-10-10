package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.Composable

/** Teak's Material 3 Expressive theme: Teak red, SN Pro, and expressive motion. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TeakTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialExpressiveTheme(
        colorScheme = if (darkTheme) darkScheme else lightScheme,
        motionScheme = MotionScheme.expressive(),
        typography = TeakTypography,
        content = content,
    )
}
