package com.praveenjuge.teak.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class FolderKind {
    @SerialName("manual") Manual,
    @SerialName("smart") Smart,
}

@Serializable
data class Folder(
    @SerialName("_id") val id: String,
    val name: String,
    val kind: FolderKind = FolderKind.Manual,
    val color: String? = null,
    val query: String? = null,
    val activeCardCount: Double = 0.0,
    val createdAt: Double = 0.0,
    val updatedAt: Double = 0.0,
) {
    val isSmart: Boolean get() = kind == FolderKind.Smart
    val cardCount: Int get() = activeCardCount.toInt()
}

@Serializable
data class TagCount(val name: String, val count: Double) {
    val cards: Int get() = count.toInt()
}

@Serializable
data class TagSummary(
    val items: List<TagCount> = emptyList(),
    val isComplete: Boolean = true,
    val computedAt: Double = 0.0,
)

@Serializable
enum class TagOperationKind {
    @SerialName("rename") Rename,
    @SerialName("merge") Merge,
    @SerialName("delete") Delete,
    ;

    val wireName: String get() = name.lowercase()
}

@Serializable
enum class TagOperationStatus {
    @SerialName("running") Running,
    @SerialName("completed") Completed,
    @SerialName("failed") Failed,
}

@Serializable
data class TagOperation(
    @SerialName("_id") val id: String,
    val kind: TagOperationKind,
    val from: String,
    val to: String? = null,
    val status: TagOperationStatus,
    val total: Double = 0.0,
    val processed: Double = 0.0,
    val changed: Double = 0.0,
    val error: String? = null,
) {
    private val changedCount: Int get() = minOf(changed, total).toInt()

    /** The progress line, as the web's tag toasts word it. */
    val title: String
        get() = when (status) {
            TagOperationStatus.Running -> when (kind) {
                TagOperationKind.Rename -> "Renaming “$from” to “$to”…"
                TagOperationKind.Merge -> "Merging “$from” into “$to”…"
                TagOperationKind.Delete -> "Deleting “$from”…"
            }
            TagOperationStatus.Completed -> when (kind) {
                TagOperationKind.Rename -> "Renamed “$from” to “$to”"
                TagOperationKind.Merge -> "Merged “$from” into “$to”"
                TagOperationKind.Delete -> "Deleted “$from”"
            }
            TagOperationStatus.Failed -> {
                val verb = when (kind) {
                    TagOperationKind.Rename -> "renaming"
                    TagOperationKind.Merge -> "merging"
                    TagOperationKind.Delete -> "deleting"
                }
                "Couldn't finish $verb. $changedCount of ${total.toInt()} cards changed."
            }
        }

    val detail: String
        get() = when (status) {
            TagOperationStatus.Running -> "$changedCount of ${total.toInt()} cards changed"
            TagOperationStatus.Completed -> if (changed.toInt() == 1) "1 card changed" else "${changed.toInt()} cards changed"
            TagOperationStatus.Failed -> "Try again to change the rest."
        }
}

/** A `[[` link's target, with its current title, or `missing` when it's gone or not yours. */
@Serializable
data class CardLinkTarget(val id: String, val missing: Boolean, val title: String? = null, val type: CardType? = null)

@Serializable
data class LinkedCard(val id: String, val title: String, val type: CardType)

@Serializable
data class CardBacklinks(val backlinks: List<LinkedCard> = emptyList(), val hasMore: Boolean = false)

@Serializable
data class SimilarAnchor(val status: String, val title: String? = null)

sealed interface RefreshOutcome {
    data object Queued : RefreshOutcome
    data class Refused(val message: String) : RefreshOutcome
}

@Serializable
data class BulkResult(val updatedIds: List<String> = emptyList(), val failedIds: List<String> = emptyList())

enum class BulkAction(val wireName: String) {
    Favorite("favorite"),
    Unfavorite("unfavorite"),
    Archive("archive"),
    Unarchive("unarchive"),
    AddTags("addTags"),
    Delete("delete"),
    Restore("restore"),
    AddToFolder("addToFolder"),
}

enum class CardSort(val wireName: String, val label: String) {
    Newest("newest", "Newest first"),
    Oldest("oldest", "Oldest first"),
    Shuffle("shuffle", "Shuffle"),
}
