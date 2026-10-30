package com.praveenjuge.teak.offline

import coil3.intercept.Interceptor
import coil3.request.ImageResult
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Card images are signed links whose `exp` and `sig` change every few hours. Coil caches by link, so each new
 * signature would download an image again and miss it offline; caching by the link without them keeps one copy.
 */
internal object StableCacheKeys : Interceptor {
    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        val request = chain.request
        val key = (request.data as? String)?.let(::stableCacheKey)
        if (key == null || request.diskCacheKey != null) return chain.proceed()
        return chain.withRequest(request.newBuilder().diskCacheKey(key).build()).proceed()
    }
}

/** The link without its signature, or null when it isn't a signed link. */
internal fun stableCacheKey(url: String): String? {
    val parsed = url.toHttpUrlOrNull() ?: return null
    if (parsed.queryParameter("exp") == null || parsed.queryParameter("sig") == null) return null
    return parsed.newBuilder().removeAllQueryParameters("exp").removeAllQueryParameters("sig").build().toString()
}
