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

/**
 * A save the free card limit refused. The backend can't record it: the refusing mutation rolls back anything it
 * queued, so the app sends the client event.
 */
fun reportCardLimit() = Analytics.capture("card_limit_reached", mapOf("source" to "android"))
