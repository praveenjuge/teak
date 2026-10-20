package com.praveenjuge.teak.core.data

data class TeakConfig(
    val convexUrl: String,
    val versionName: String,
    val isDebug: Boolean,
    val workosBaseUrl: String = HOSTED_WORKOS,
) {
    companion object {
        const val HOSTED_WORKOS = "https://api.workos.com"
    }
}
