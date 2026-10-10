package com.praveenjuge.teak.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The eight card types the backend stores, with the names the iPhone app shows. */
@Serializable
enum class CardType(val label: String, val plural: String) {
    @SerialName("text") Text("Text", "Notes"),
    @SerialName("link") Link("Link", "Links"),
    @SerialName("image") Image("Image", "Images"),
    @SerialName("video") Video("Video", "Videos"),
    @SerialName("audio") Audio("Audio", "Audio"),
    @SerialName("document") Document("Document", "Documents"),
    @SerialName("palette") Palette("Palette", "Palettes"),
    @SerialName("quote") Quote("Quote", "Quotes"),
    ;

    /** The value Convex expects for this type. */
    val wireName: String get() = name.lowercase()
}

/** One tile in the library grid (`cards:searchMobileCardSummariesPaginated`). */
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
)

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
)

@Serializable
data class LinkFact(
    val label: String,
    val value: String,
)

@Serializable
data class LinkCategory(
    val category: String? = null,
    val facts: List<LinkFact>? = null,
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

/** The full card for the detail and edit screens (`cards:getCard`). */
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
) {
    val favorited: Boolean get() = isFavorited == true
    val deleted: Boolean get() = isDeleted == true
}

/** `auth:getCurrentUser`. */
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
    val plan: String get() = if (hasPremium) "Pro" else "Free"

    /** "12 of 200 Cards" on Free, "12 Cards" on Pro, like iOS. */
    val usageLabel: String
        get() {
            val count = cardCount.toInt()
            val noun = if (count == 1) "Card" else "Cards"
            return if (hasPremium) "$count $noun" else "$count of $FREE_TIER_LIMIT Cards"
        }

    companion object {
        const val FREE_TIER_LIMIT = 200
    }
}

/** `auth:getAuthMode`: whether sign-up is open and which WorkOS client signs in. */
@Serializable
data class AuthMode(
    val primary: String,
    val signupsDisabled: Boolean,
    val accountChangesPaused: Boolean,
    val authKitClientId: String? = null,
) {
    /** The client ID, if the deployment sent a well-formed one. */
    val validClientId: String?
        get() = authKitClientId?.takeIf { primary == "workos" && WORKOS_CLIENT_ID.matches(it) }
}

private val WORKOS_CLIENT_ID = Regex("^client_[A-Za-z0-9]{1,128}$")

/** The color buckets the server can filter by. */
enum class ColorHue(val wireName: String, val label: String, val hex: Long) {
    Red("red", "Red", 0xFFEF4444),
    Orange("orange", "Orange", 0xFFF97316),
    Yellow("yellow", "Yellow", 0xFFEAB308),
    Green("green", "Green", 0xFF22C55E),
    Teal("teal", "Teal", 0xFF14B8A6),
    Cyan("cyan", "Cyan", 0xFF06B6D4),
    Blue("blue", "Blue", 0xFF3B82F6),
    Purple("purple", "Purple", 0xFFA855F7),
    Pink("pink", "Pink", 0xFFEC4899),
    Brown("brown", "Brown", 0xFF92400E),
    Neutral("neutral", "Neutral", 0xFF737373),
}

/** User-facing messages the backend and iOS share. */
object TeakMessages {
    const val SIGNUPS_PAUSED = "New sign-ups are paused right now. Please try again later."
    const val ACCOUNT_CHANGES_PAUSED = "Account changes are paused right now. Please try again later."
}

/** 100 MB, the backend's upload limit. */
const val MAX_FILE_SIZE: Long = 100L * 1024 * 1024

/** The most items one share or one picker selection saves, like iOS. */
const val MAX_FILES_PER_UPLOAD = 5
