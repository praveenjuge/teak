package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/**
 * The newest favorites as the Favorites widget shows them, as Apple's `FavoritesSnapshot`. The app writes it to
 * its own files while it runs signed in and deletes it on sign-out, so the widget never touches the network. It
 * holds what a tile shows (a short title, a palette, a small thumbnail), never a card in Trash or the Archive.
 */
@Serializable
data class FavoritesSnapshot(val cards: List<Card> = emptyList()) {
    @Serializable
    data class Card(
        val id: String,
        val type: CardType,
        /** The words a tile without a picture shows; blank when the card has none. */
        val title: String = "",
        /** A palette's first colors, as `#RRGGBB`. */
        val colors: List<String> = emptyList(),
        /** The thumbnail's file name in the snapshot's folder, when it has one. */
        val image: String? = null,
    ) {
        companion object {
            /**
             * The card as a tile shows it, and where its thumbnail comes from. The file name changes with the
             * thumbnail (ignoring a signed URL's query), so a replaced image is fetched again.
             */
            fun from(summary: CardSummary): Pair<Card, String?>? {
                if (summary.archived || !CARD_ID.matches(summary.id)) return null
                val thumbnail = CardGrid.tileImageUrl(summary)?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
                val colors = summary.colors.orEmpty()
                    .mapNotNull { PaletteEdit.storedHex(CardColor(it)) }
                    .take(MAX_COLORS)
                val card = Card(
                    id = summary.id,
                    type = summary.type,
                    title = title(summary),
                    colors = if (summary.type == CardType.Palette) colors else emptyList(),
                    image = thumbnail?.let { "${summary.id}-${Integer.toHexString(it.substringBefore('?').hashCode())}.jpg" },
                )
                return card to thumbnail
            }

            private fun title(summary: CardSummary): String {
                val words = when (summary.type) {
                    CardType.Text -> summary.previewText?.let(MarkdownBlocks::toPlainText) ?: summary.title
                    CardType.Quote -> summary.previewText ?: summary.title
                    CardType.Link -> summary.title.ifBlank { summary.url?.let(UrlHost::normalize)?.let(UrlHost::forDisplay).orEmpty() }
                    else -> summary.title.ifBlank { summary.fileName.orEmpty() }
                }
                return words.trim().take(MAX_TITLE)
            }
        }
    }

    companion object {
        /** The most a widget shows: one small, four medium, six large. */
        const val LIMIT = 6
        const val MAX_COLORS = 5
        private const val MAX_TITLE = 200
        private const val FILE_NAME = "favorites.json"
        private val CARD_ID = Regex("[a-z0-9]{16,64}")
        private val json = Json { ignoreUnknownKeys = true }

        /**
         * Arguments for the newest favorites, as the library's Favorites filter reads them. A live page keeps the
         * end it first loaded with, so unfavoriting shrinks it rather than pulling in the next favorite: a full
         * page leaves room for that, and for cards the snapshot skips.
         */
        val searchArgs: Map<String, Any?>
            get() = LibraryFilters(favoritesOnly = true).toSearchArgs() +
                ("paginationOpts" to mapOf("numItems" to 100, "cursor" to null))

        fun folder(filesDir: File): File = File(filesDir, "widgets")

        fun read(folder: File): FavoritesSnapshot =
            runCatching { json.decodeFromString(serializer(), File(folder, FILE_NAME).readText()) }
                .getOrDefault(FavoritesSnapshot())

        /** Deletes the snapshot and its thumbnails; false when there was none. */
        fun clear(folder: File): Boolean = folder.exists() && folder.deleteRecursively()
    }

    /** Writes the snapshot and its thumbnails, keyed by file name, then drops thumbnails it no longer names. */
    fun write(folder: File, images: Map<String, ByteArray>) {
        folder.mkdirs()
        for ((name, bytes) in images) writeAtomically(File(folder, name), bytes)
        writeAtomically(File(folder, FILE_NAME), json.encodeToString(serializer(), this).toByteArray())
        val kept = cards.mapNotNull(Card::image).toSet() + FILE_NAME
        folder.listFiles()?.filter { it.name !in kept }?.forEach(File::delete)
    }

    private fun writeAtomically(file: File, bytes: ByteArray) {
        val partial = File(file.parentFile, "${file.name}.partial")
        partial.writeBytes(bytes)
        if (!partial.renameTo(file)) {
            partial.delete()
            error("Couldn't save ${file.name}")
        }
    }
}
