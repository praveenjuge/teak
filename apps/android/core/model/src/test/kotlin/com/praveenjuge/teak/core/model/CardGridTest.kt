package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import org.junit.Test
import kotlin.test.assertEquals

class CardGridTest {
    private fun summary(id: String, type: CardType, ratio: Double? = null, image: String? = null) =
        CardSummary(id = id, creationTime = 0.0, type = type, title = id, aspectRatio = ratio, compactUrl = image)

    @Serializable
    private data class ColumnRow(val width: Int, val columns: Int)

    @Serializable
    private data class Rows(val columns: List<ColumnRow>)

    @Test
    fun `columns grow with the window as on Apple`() {
        for (row in Fixtures.load<Rows>("cardGrid").columns) {
            assertEquals(row.columns, CardGrid.columnCount(row.width.toFloat()), "${row.width} dp")
        }
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
