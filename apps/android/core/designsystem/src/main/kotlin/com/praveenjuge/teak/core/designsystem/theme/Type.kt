package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.praveenjuge.teak.core.designsystem.R

/** SN Pro, Teak's rounded typeface, as one variable font covering weights 200 to 900. */
val SnPro = FontFamily(
    listOf(200, 300, 400, 500, 600, 700, 800, 900).map { weight ->
        Font(
            resId = R.font.sn_pro,
            weight = FontWeight(weight),
            variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
        )
    },
)

private fun TextStyle.sn() = copy(fontFamily = SnPro)

internal val TeakTypography: Typography = Typography().run {
    Typography(
        displayLarge = displayLarge.sn(),
        displayMedium = displayMedium.sn(),
        displaySmall = displaySmall.sn(),
        headlineLarge = headlineLarge.sn().copy(fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.sn().copy(fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.sn().copy(fontWeight = FontWeight.SemiBold),
        titleLarge = titleLarge.sn().copy(fontWeight = FontWeight.SemiBold),
        titleMedium = titleMedium.sn().copy(fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.sn(),
        bodyLarge = bodyLarge.sn(),
        bodyMedium = bodyMedium.sn(),
        bodySmall = bodySmall.sn(),
        labelLarge = labelLarge.sn(),
        labelMedium = labelMedium.sn(),
        labelSmall = labelSmall.sn(),
    )
}
