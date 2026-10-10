package com.praveenjuge.teak.core.data

/** Build-time facts the app module supplies: which Convex deployment to use, and the app version. */
data class TeakConfig(
    val convexUrl: String,
    val versionName: String,
    val isDebug: Boolean,
)
