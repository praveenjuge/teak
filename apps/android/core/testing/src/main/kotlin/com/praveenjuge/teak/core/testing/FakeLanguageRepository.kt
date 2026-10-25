package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.repository.LanguageRepository
import kotlinx.coroutines.flow.MutableStateFlow

class FakeLanguageRepository(initial: String = "en") : LanguageRepository {
    override val current = MutableStateFlow(initial)
    var saveError: Exception? = null
    val saved = mutableListOf<String>()

    override suspend fun choose(code: String) {
        val previous = current.value
        current.value = code
        saveError?.let {
            current.value = previous
            throw it
        }
        saved += code
    }

    override suspend fun follow() = Unit
}
