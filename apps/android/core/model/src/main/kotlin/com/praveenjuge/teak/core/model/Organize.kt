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

    /** The progress line, as the web's tag toasts word it, in the app's language. */
    val titleText: UiText
        get() {
            val target = to.orEmpty()
            val count = total.toInt()
            return when (status) {
                TagOperationStatus.Running -> when (kind) {
                    TagOperationKind.Rename -> UiText.of("native.tags.renaming", from, target)
                    TagOperationKind.Merge -> UiText.of("native.tags.merging", from, target)
                    TagOperationKind.Delete -> UiText.of("native.tags.deleting", from)
                }
                TagOperationStatus.Completed -> when (kind) {
                    TagOperationKind.Rename -> UiText.of("native.tags.renamed", from, target)
                    TagOperationKind.Merge -> UiText.of("native.tags.merged", from, target)
                    TagOperationKind.Delete -> UiText.of("native.tags.deleted", from)
                }
                TagOperationStatus.Failed -> when (kind) {
                    TagOperationKind.Rename -> UiText.of("native.tags.renameFailed", changedCount.toString(), count = count)
                    TagOperationKind.Merge -> UiText.of("native.tags.mergeFailed", changedCount.toString(), count = count)
                    TagOperationKind.Delete -> UiText.of("native.tags.deleteFailed", changedCount.toString(), count = count)
                }
            }
        }

    /** How many cards the change has reached, in the app's language. */
    val detailText: UiText
        get() = when (status) {
            TagOperationStatus.Running -> UiText.of("native.tags.progress", changedCount.toString(), count = total.toInt())
            TagOperationStatus.Completed -> UiText.of("native.tags.changed", count = changed.toInt())
            TagOperationStatus.Failed -> UiText.of("native.tags.tryRest")
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
    data class Refused(val message: String?) : RefreshOutcome
}

/**
 * `cards:trashCount`, and what `cards:emptyTrash` will delete: the cards in Trash. [more] means Trash
 * holds more than [count], so the count reads "this many or more".
 */
@Serializable
data class TrashCount(val count: Double, val more: Boolean = false) {
    val cardCount: Int get() = count.toInt()
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

enum class CardSort(val wireName: String) {
    Newest("newest"),
    Oldest("oldest"),
    Shuffle("shuffle"),
    ;

    val labelText: UiText
        get() = when (this) {
            Newest -> UiText.of("native.filters.sort.newest")
            Oldest -> UiText.of("native.filters.sort.oldest")
            Shuffle -> UiText.of("native.filters.sort.shuffle")
        }
}
