package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals

class CardGridTest {
    private fun summary(id: String, type: CardType, ratio: Double? = null, image: String? = null) =
        CardSummary(id = id, creationTime = 0.0, type = type, title = id, aspectRatio = ratio, compactUrl = image)

    @Test
    fun `columns grow with the window`() {
        assertEquals(2, CardGrid.columnCount(411f))
        assertEquals(3, CardGrid.columnCount(700f))
        assertEquals(4, CardGrid.columnCount(1280f))
    }

    @Test
    fun `extreme aspect ratios are clamped`() {
        assertEquals(2.5, CardGrid.tileImageRatio(summary("a", CardType.Image, ratio = 9.0)))
        assertEquals(0.5, CardGrid.tileImageRatio(summary("a", CardType.Image, ratio = 0.1)))
        assertEquals(1.91, CardGrid.tileImageRatio(summary("a", CardType.Link)))
    }

    @Test
    fun `each card goes to the shortest column`() {
        val columns = CardGrid.distribute(listOf(100.0, 10.0, 10.0, 10.0), 2, gap = 0.0) { it }
        assertEquals(listOf(listOf(100.0), listOf(10.0, 10.0, 10.0)), columns)
    }

    @Test
    fun `waveform heights stay within the drawable band and repeat for the same seed`() {
        val heights = CardGrid.waveformHeights("card-1")
        assertEquals(CardGrid.WAVEFORM_BAR_COUNT, heights.size)
        heights.forEach { assert(it in 0.2f..0.8f) }
        assertEquals(heights, CardGrid.waveformHeights("card-1"))
    }
}
