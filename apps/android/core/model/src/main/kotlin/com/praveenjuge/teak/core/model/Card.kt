package com.praveenjuge.teak.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class CardType {
    @SerialName("text") Text,
    @SerialName("link") Link,
    @SerialName("image") Image,
    @SerialName("video") Video,
    @SerialName("audio") Audio,
    @SerialName("document") Document,
    @SerialName("palette") Palette,
    @SerialName("quote") Quote,
    ;

    val wireName: String get() = name.lowercase()

    /** The type's name in the app's language: "Image". */
    val labelText: UiText
        get() = when (this) {
            Text -> UiText.of("cards.types.text")
            Link -> UiText.of("cards.types.link")
            Image -> UiText.of("cards.types.image")
            Video -> UiText.of("cards.types.video")
            Audio -> UiText.of("cards.types.audio")
            Document -> UiText.of("cards.types.document")
            Palette -> UiText.of("cards.types.palette")
            Quote -> UiText.of("cards.types.quote")
        }

    /** The library's title for the type: "Notes". */
    val pluralText: UiText
        get() = when (this) {
            Text -> UiText.of("native.filters.types.text")
            Link -> UiText.of("native.filters.types.link")
            Image -> UiText.of("native.filters.types.image")
            Video -> UiText.of("native.filters.types.video")
            Audio -> UiText.of("native.filters.types.audio")
            Document -> UiText.of("native.filters.types.document")
            Palette -> UiText.of("native.filters.types.palette")
            Quote -> UiText.of("native.filters.types.quote")
        }

    /** The library's title for the type's favorites: "Favorite notes". */
    val favoritesText: UiText
        get() = when (this) {
            Text -> UiText.of("native.filters.favoriteTypes.text")
            Link -> UiText.of("native.filters.favoriteTypes.link")
            Image -> UiText.of("native.filters.favoriteTypes.image")
            Video -> UiText.of("native.filters.favoriteTypes.video")
            Audio -> UiText.of("native.filters.favoriteTypes.audio")
            Document -> UiText.of("native.filters.favoriteTypes.document")
            Palette -> UiText.of("native.filters.favoriteTypes.palette")
            Quote -> UiText.of("native.filters.favoriteTypes.quote")
        }

    val showsSummaryColors: Boolean get() = this != Palette
}

@Serializable
data class CardSummary(
    @SerialName("_id") val id: String,
    @SerialName("_creationTime") val creationTime: Double,
    val type: CardType,
    val title: String,
    val previewText: String? = null,
    val url: String? = null,
    val fileName: String? = null,
    val isFavorited: Boolean? = null,
    val colors: List<String>? = null,
    val aspectRatio: Double? = null,
    val thumbnailUrl: String? = null,
    val compactUrl: String? = null,
    val placeholderUrl: String? = null,
    val screenshotUrl: String? = null,
    val linkPreviewImageUrl: String? = null,
    val isArchived: Boolean? = null,
    val completedAt: Double? = null,
    val linkCategory: String? = null,
    val linkPrice: LinkPrice? = null,
) {
    val archived: Boolean get() = isArchived == true
    val isDone: Boolean get() = completedAt != null
}

@Serializable
data class CardSummaryPage(
    val page: List<CardSummary>,
    val isDone: Boolean,
    val continueCursor: String? = null,
)

@Serializable
data class CardColor(
    val hex: String,
    val name: String? = null,
)

@Serializable
data class FilePreviewFacts(
    val slideCount: Double? = null,
    val wordCount: Double? = null,
    val archiveFileCount: Double? = null,
    val archiveDirectoryCount: Double? = null,
)

@Serializable
data class FileMetadata(
    val fileSize: Double? = null,
    val fileName: String? = null,
    val mimeType: String? = null,
    val extension: String? = null,
    val kind: String? = null,
    val language: String? = null,
    val duration: Double? = null,
    val width: Double? = null,
    val height: Double? = null,
    val preview: FilePreviewFacts? = null,
    val exif: ImageExif? = null,
)

@Serializable
data class LinkPreview(
    val status: String? = null,
    val url: String? = null,
    val finalUrl: String? = null,
    val title: String? = null,
    val description: String? = null,
    val faviconUrl: String? = null,
    val siteName: String? = null,
    val author: String? = null,
    val publisher: String? = null,
    val publishedAt: String? = null,
)

@Serializable
data class LinkFact(
    val label: String,
    val value: String,
    val icon: String? = null,
)

@Serializable
data class LinkCategory(
    val category: String? = null,
    val facts: List<LinkFact>? = null,
    val price: LinkPrice? = null,
)

@Serializable
data class CardMetadata(
    val linkPreview: LinkPreview? = null,
    val linkCategory: LinkCategory? = null,
)

@Serializable
data class LinkPreviewMedia(
    val type: String,
    val url: String,
    val width: Double? = null,
    val height: Double? = null,
    val posterUrl: String? = null,
)

@Serializable
data class Card(
    @SerialName("_id") val id: String,
    @SerialName("_creationTime") val creationTime: Double,
    val type: CardType,
    val content: String = "",
    val url: String? = null,
    val notes: String? = null,
    val tags: List<String>? = null,
    val aiTags: List<String>? = null,
    val aiSummary: String? = null,
    val aiTranscript: String? = null,
    val metadataTitle: String? = null,
    val metadataDescription: String? = null,
    val isFavorited: Boolean? = null,
    val isDeleted: Boolean? = null,
    val createdAt: Double = creationTime,
    val updatedAt: Double = creationTime,
    val colors: List<CardColor>? = null,
    val fileMetadata: FileMetadata? = null,
    val metadata: CardMetadata? = null,
    val fileUrl: String? = null,
    val detailUrl: String? = null,
    val thumbnailUrl: String? = null,
    val compactUrl: String? = null,
    val placeholderUrl: String? = null,
    val screenshotUrl: String? = null,
    val linkPreviewImageUrl: String? = null,
    val linkPreviewMedia: List<LinkPreviewMedia>? = null,
    val isArchived: Boolean? = null,
    val completedAt: Double? = null,
    val isHidden: Boolean? = null,
    val sourceUrl: String? = null,
    val sourceTitle: String? = null,
    val folderIds: List<String>? = null,
) {
    val favorited: Boolean get() = isFavorited == true
    val deleted: Boolean get() = isDeleted == true
    val archived: Boolean get() = isArchived == true
    val isDone: Boolean get() = completedAt != null
    val hidden: Boolean get() = isHidden == true || Tags.isHiddenList(tags)
    val linkCategoryName: String? get() = metadata?.linkCategory?.category
}

/** The account's display preferences: its language, as a BCP 47 code. */
@Serializable
data class AccountPreferences(val locale: String)

@Serializable
data class CurrentUser(
    @SerialName("_id") val id: String,
    val email: String,
    val emailVerified: Boolean = false,
    val name: String? = null,
    val hasPremium: Boolean = false,
    val cardCount: Double = 0.0,
    val canCreateCard: Boolean = true,
) {
    /** The plan's name: "Pro" stays as it is. */
    val planText: UiText get() = if (hasPremium) UiText.verbatim("Pro") else UiText.of("native.card.plan.free")

    /** "3 cards", or "3 of 200 cards" on Free. */
    fun usageText(locale: java.util.Locale = java.util.Locale.getDefault()): UiText {
        val count = cardCount.toInt()
        return if (hasPremium) {
            UiText.of("native.common.cardCount", count = count)
        } else {
            UiText.of("native.card.usage", java.text.NumberFormat.getIntegerInstance(locale).format(count), count = FREE_TIER_LIMIT)
        }
    }
}

@Serializable
data class AuthMode(
    val primary: String,
    val signupsDisabled: Boolean,
    val authKitClientId: String? = null,
) {
    val validClientId: String?
        get() = authKitClientId?.takeIf { primary == "workos" && WORKOS_CLIENT_ID.matches(it) }
}

private val WORKOS_CLIENT_ID = Regex("^client_[A-Za-z0-9]{1,128}$")

enum class ColorHue(val hex: Long) {
    Red(0xFFEF4444),
    Orange(0xFFF97316),
    Yellow(0xFFEAB308),
    Green(0xFF22C55E),
    Teal(0xFF14B8A6),
    Cyan(0xFF06B6D4),
    Blue(0xFF3B82F6),
    Purple(0xFFA855F7),
    Pink(0xFFEC4899),
    Brown(0xFF92400E),
    Neutral(0xFF737373),
    ;

    val wireName: String get() = name.lowercase()

    val labelText: UiText
        get() = when (this) {
            Red -> UiText.of("search.colorHues.red")
            Orange -> UiText.of("search.colorHues.orange")
            Yellow -> UiText.of("search.colorHues.yellow")
            Green -> UiText.of("search.colorHues.green")
            Teal -> UiText.of("search.colorHues.teal")
            Cyan -> UiText.of("search.colorHues.cyan")
            Blue -> UiText.of("search.colorHues.blue")
            Purple -> UiText.of("search.colorHues.purple")
            Pink -> UiText.of("search.colorHues.pink")
            Brown -> UiText.of("search.colorHues.brown")
            Neutral -> UiText.of("search.colorHues.neutral")
        }
}
