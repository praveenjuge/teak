package com.praveenjuge.teak.core.model

data class LibraryFilters(
    val favoritesOnly: Boolean = false,
    val trashOnly: Boolean = false,
    val types: List<CardType> = emptyList(),
    val hue: ColorHue? = null,
) {
    val isActive: Boolean
        get() = favoritesOnly || trashOnly || types.isNotEmpty() || hue != null

    fun toggleType(type: CardType): LibraryFilters =
        copy(types = if (type in types) types - type else types + type)

    val title: String
        get() {
            if (trashOnly) return "Trash"
            val typeTitle = types.singleOrNull()?.plural
            if (favoritesOnly) return if (typeTitle != null) "Favorite $typeTitle" else "Favorites"
            if (typeTitle != null) return typeTitle
            hue?.let { return it.label }
            return if (types.size > 1) "Filtered" else "Home"
        }

    fun toSearchArgs(): Map<String, Any> = buildMap {
        if (favoritesOnly) put("favoritesOnly", true)
        hue?.let { put("hueFilters", listOf(it.wireName)) }
        if (trashOnly) put("showTrashOnly", true)
        if (types.isNotEmpty()) put("types", types.map { it.wireName })
    }

    companion object {
        val Empty = LibraryFilters()
    }
}
