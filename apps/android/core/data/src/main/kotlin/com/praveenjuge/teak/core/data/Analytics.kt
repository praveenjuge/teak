package com.praveenjuge.teak.core.data

/**
 * Sends events from `ClientEventCatalog` (`packages/convex/shared/analytics.ts`), by the same names and
 * properties. The app points [recorder] at PostHog in release builds; anywhere else events go nowhere.
 */
object Analytics {
    @Volatile var recorder: ((event: String, properties: Map<String, Any>) -> Unit)? = null

    fun capture(event: String, properties: Map<String, Any> = emptyMap()) {
        recorder?.invoke(event, properties)
    }
}
