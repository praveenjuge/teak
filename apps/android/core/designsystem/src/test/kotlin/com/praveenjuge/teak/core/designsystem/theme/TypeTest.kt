package com.praveenjuge.teak.core.designsystem.theme

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.ResourceFont
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.praveenjuge.teak.core.designsystem.R
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class TypeTest {
    private val density = Density(1f)

    private fun opticalSizes(style: androidx.compose.ui.text.TextStyle): Set<Float> =
        (style.fontFamily as FontListFontFamily).fonts.map { font ->
            (font as ResourceFont).variationSettings.settings
                .single { it.axisName == "opsz" }
                .toVariationValue(density)
        }.toSet()

    @Test
    fun `optical size follows the font size between 9 and 32`() {
        assertEquals(32f, alloOpticalSize(57.sp))
        assertEquals(24f, alloOpticalSize(24.sp))
        assertEquals(14f, alloOpticalSize(14.sp))
        assertEquals(11f, alloOpticalSize(11.sp))
        assertEquals(9f, alloOpticalSize(6.sp))
        assertEquals(14f, alloOpticalSize(1.2.em))
    }

    @Test
    fun `every style uses Allo at its own optical size`() {
        val styles = with(TeakTypography) {
            listOf(
                displayLarge, displayMedium, displaySmall,
                headlineLarge, headlineMedium, headlineSmall,
                titleLarge, titleMedium, titleSmall,
                bodyLarge, bodyMedium, bodySmall,
                labelLarge, labelMedium, labelSmall,
            )
        }
        for (style in styles) {
            val fonts = (style.fontFamily as FontListFontFamily).fonts
            assertEquals((100..900 step 100).toList(), fonts.map { it.weight.weight })
            fonts.forEach { assertEquals(R.font.allo, (it as ResourceFont).resId) }
            assertEquals(setOf(alloOpticalSize(style.fontSize)), opticalSizes(style))
        }
        assertEquals(setOf(32f), opticalSizes(TeakTypography.displayLarge))
        assertEquals(setOf(14f), opticalSizes(TeakTypography.bodyMedium))
    }

    @Test
    fun `styles at the same size share one family`() {
        assertSame(TeakTypography.titleSmall.fontFamily, TeakTypography.labelLarge.fontFamily)
        assertSame(Allo, TeakTypography.bodyMedium.fontFamily)
    }

    @Test
    fun `a style grown past its type-scale size takes the optical size of its new size`() {
        val heading = TeakTypography.bodyLarge.copy(fontSize = 24.sp).withAlloOpticalSize()
        assertEquals(setOf(24f), opticalSizes(heading))
        val code = TeakTypography.bodyLarge.copy(fontFamily = FontFamily.Monospace, fontSize = 24.sp)
        assertSame(FontFamily.Monospace, code.withAlloOpticalSize().fontFamily)
    }
}
