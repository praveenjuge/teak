package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import com.praveenjuge.teak.core.designsystem.R

// Allo by Josh Puckett (SIL OFL 1.1), the web app's font: the variable face
// with roundness fixed at 50, with weight 100 to 900 and optical size 9 to 32.
private val ALLO_WEIGHTS = (100..900 step 100).toList()
private const val ALLO_MIN_OPTICAL_SIZE = 9f
private const val ALLO_MAX_OPTICAL_SIZE = 32f
private const val ALLO_TEXT_OPTICAL_SIZE = 14f

/**
 * Browsers set Allo's optical size from the font size; Android doesn't, so
 * each style asks for its own. 32 is drawn and spaced for headlines, 14 for
 * text, and below 14 only the spacing opens up.
 */
internal fun alloOpticalSize(fontSize: TextUnit): Float =
    if (fontSize.isSp) {
        fontSize.value.coerceIn(ALLO_MIN_OPTICAL_SIZE, ALLO_MAX_OPTICAL_SIZE)
    } else {
        ALLO_TEXT_OPTICAL_SIZE
    }

private val alloFamilies = mutableMapOf<Float, FontFamily>()

internal fun alloFamily(opticalSize: Float): FontFamily = alloFamilies.getOrPut(opticalSize) {
    FontFamily(
        ALLO_WEIGHTS.map { weight ->
            Font(
                resId = R.font.allo,
                weight = FontWeight(weight),
                variationSettings = FontVariation.Settings(
                    FontVariation.weight(weight),
                    FontVariation.Setting("opsz", opticalSize),
                ),
            )
        },
    )
}

/** Allo at text size, for text that sets its own size outside the type scale. */
val Allo: FontFamily = alloFamily(ALLO_TEXT_OPTICAL_SIZE)

private fun TextStyle.allo() = copy(fontFamily = alloFamily(alloOpticalSize(fontSize)))

/**
 * Re-picks Allo's optical size for this style's own font size. Use it after
 * changing the size of a type-scale style, such as a Markdown heading grown
 * from body text. A style in another family is returned as it is.
 */
fun TextStyle.withAlloOpticalSize(): TextStyle =
    if (fontFamily in alloFamilies.values) allo() else this

internal val TeakTypography: Typography = Typography().run {
    Typography(
        displayLarge = displayLarge.allo(),
        displayMedium = displayMedium.allo(),
        displaySmall = displaySmall.allo(),
        headlineLarge = headlineLarge.allo().copy(fontWeight = FontWeight.Bold),
        headlineMedium = headlineMedium.allo().copy(fontWeight = FontWeight.Bold),
        headlineSmall = headlineSmall.allo().copy(fontWeight = FontWeight.SemiBold),
        titleLarge = titleLarge.allo().copy(fontWeight = FontWeight.SemiBold),
        titleMedium = titleMedium.allo().copy(fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.allo(),
        bodyLarge = bodyLarge.allo(),
        bodyMedium = bodyMedium.allo(),
        bodySmall = bodySmall.allo(),
        labelLarge = labelLarge.allo(),
        labelMedium = labelMedium.allo(),
        labelSmall = labelSmall.allo(),
    )
}
