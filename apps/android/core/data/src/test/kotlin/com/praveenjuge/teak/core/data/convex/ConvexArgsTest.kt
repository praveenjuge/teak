package com.praveenjuge.teak.core.data.convex

import org.junit.Test
import kotlin.test.assertEquals

class ConvexArgsTest {
    @Test
    fun `numbers go to Convex as float64, however deeply nested`() {
        val args = mapOf(
            "count" to 20,
            "size" to 5L,
            "ratio" to 1.5f,
            "width" to 640.0,
            "paginationOpts" to mapOf("numItems" to 20, "cursor" to null),
            "range" to listOf(10L, mapOf("end" to 20L)),
            "name" to "photo.jpg",
            "favorite" to true,
        )

        assertEquals(
            mapOf(
                "count" to 20.0,
                "size" to 5.0,
                "ratio" to 1.5,
                "width" to 640.0,
                "paginationOpts" to mapOf("numItems" to 20.0, "cursor" to null),
                "range" to listOf(10.0, mapOf("end" to 20.0)),
                "name" to "photo.jpg",
                "favorite" to true,
            ),
            args.withNumbersAsDoubles(),
        )
    }
}
