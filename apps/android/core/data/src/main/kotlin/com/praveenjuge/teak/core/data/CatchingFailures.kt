package com.praveenjuge.teak.core.data

import kotlinx.coroutines.CancellationException

/** Like [runCatching], but cancellation still cancels and an [Error] still crashes. */
inline fun <T> catchingFailures(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }
