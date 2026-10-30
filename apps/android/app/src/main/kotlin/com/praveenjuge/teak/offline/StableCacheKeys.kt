package com.praveenjuge.teak.offline

import coil3.intercept.Interceptor
import coil3.network.CacheStrategy
import coil3.network.NetworkRequest
import coil3.network.NetworkResponse
import coil3.request.ImageResult
import coil3.request.Options
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

/**
 * Coil's default strategy also stores some failures, such as a 404, and writes them before it checks the status.
 * Under [StableCacheKeys] a stored failure would outlive every new signature, so only answers that carry the image
 * (or confirm the stored one) are kept.
 */
internal object SuccessfulResponsesOnly : CacheStrategy {
    override suspend fun read(cacheResponse: NetworkResponse, networkRequest: NetworkRequest, options: Options) =
        CacheStrategy.DEFAULT.read(cacheResponse, networkRequest, options)

    override suspend fun write(
        cacheResponse: NetworkResponse?,
        networkRequest: NetworkRequest,
        networkResponse: NetworkResponse,
        options: Options,
    ): CacheStrategy.WriteResult =
        if (networkResponse.code in 200..299 || networkResponse.code == 304) {
            CacheStrategy.DEFAULT.write(cacheResponse, networkRequest, networkResponse, options)
        } else {
            CacheStrategy.WriteResult.DISABLED
        }
}
