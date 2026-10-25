package com.praveenjuge.teak.core.model

import kotlin.random.Random

const val MAX_SHUFFLE_SEED = Int.MAX_VALUE

data class LibraryFilters(
    val favoritesOnly: Boolean = false,
    val trashOnly: Boolean = false,
    val archivedOnly: Boolean = false,
    val types: List<CardType> = emptyList(),
    val hue: ColorHue? = null,
    val sort: CardSort = CardSort.Newest,
    val shuffleSeed: Int = 0,
) {
    val isActive: Boolean
        get() = favoritesOnly || trashOnly || archivedOnly || types.isNotEmpty() || hue != null

    fun toggleType(type: CardType): LibraryFilters =
        copy(types = if (type in types) types - type else types + type)

    /** Archive and Trash are separate views: turning one on turns the other off. */
    fun toggleArchive(): LibraryFilters = copy(archivedOnly = !archivedOnly, trashOnly = false)

    fun toggleTrash(): LibraryFilters = copy(trashOnly = !trashOnly, archivedOnly = false)

    /** Every pick of Shuffle draws a new seed, so it reshuffles. */
    fun sorted(sort: CardSort, random: Random = Random.Default): LibraryFilters =
        copy(sort = sort, shuffleSeed = if (sort == CardSort.Shuffle) random.nextInt(0, MAX_SHUFFLE_SEED) else 0)

    val title: String
        get() {
            if (trashOnly) return "Trash"
            if (archivedOnly) return "Archive"
            val typeTitle = types.singleOrNull()?.plural
            if (favoritesOnly) return if (typeTitle != null) "Favorite $typeTitle" else "Favorites"
            if (typeTitle != null) return typeTitle
            hue?.let { return it.label }
            return if (types.size > 1) "Filtered" else "Home"
        }

    /** [title] in the app's language. */
    val titleText: UiText
        get() {
            if (trashOnly) return UiText.of("native.filters.trash")
            if (archivedOnly) return UiText.of("native.filters.archive")
            val type = types.singleOrNull()
            if (favoritesOnly) return type?.favoritesText ?: UiText.of("native.filters.favorites")
            if (type != null) return type.pluralText
            hue?.let { return it.labelText }
            return if (types.size > 1) UiText.of("native.filters.filtered") else UiText.of("native.filters.home")
        }

    /**
     * The search a smart folder saves, matching Apple: types, favorites and archive as qualifiers,
     * then the typed [search]. Colors aren't saved, and Trash can't be a smart folder.
     */
    fun smartFolderQuery(search: String): String? {
        if (trashOnly) return null
        val parts = types.map { SearchQuery.format(SearchQualifier.Type(it)) }.toMutableList()
        if (favoritesOnly) parts += SearchQuery.format(SearchQualifier.Is(SearchIsValue.Favorite))
        if (archivedOnly) parts += SearchQuery.format(SearchQualifier.Is(SearchIsValue.Archived))
        search.trim().takeIf { it.isNotEmpty() }?.let { parts += it }
        return parts.joinToString(" ").takeIf { it.isNotEmpty() }
    }

    fun toSearchArgs(): Map<String, Any> = buildMap {
        if (favoritesOnly) put("favoritesOnly", true)
        hue?.let { put("hueFilters", listOf(it.wireName)) }
        if (trashOnly) put("showTrashOnly", true)
        if (archivedOnly) put("showArchivedOnly", true)
        if (types.isNotEmpty()) put("types", types.map { it.wireName })
        if (sort != CardSort.Newest) put("sort", sort.wireName)
        if (sort == CardSort.Shuffle) put("shuffleSeed", shuffleSeed)
    }

    companion object {
        val Empty = LibraryFilters()
    }
}
