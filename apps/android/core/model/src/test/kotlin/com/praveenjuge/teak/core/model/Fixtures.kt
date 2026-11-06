package com.praveenjuge.teak.core.model

import kotlinx.serialization.json.Json

/**
 * Test cases in `packages/convex/__tests__/shared/fixtures`, which the TypeScript tests and Apple's
 * TeakCore tests read too, so every port runs the same rows. Gradle puts them on the test classpath.
 */
object Fixtures {
    val json = Json { ignoreUnknownKeys = true }

    fun text(name: String): String =
        checkNotNull(Fixtures::class.java.getResource("/$name.json")) { "No $name fixture on the test classpath" }.readText()

    inline fun <reified T> load(name: String): T = json.decodeFromString(text(name))
}
