package com.praveenjuge.teak.feature.organize

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.TagsRepository
import com.praveenjuge.teak.core.model.TagCount
import com.praveenjuge.teak.core.model.TagOperation
import com.praveenjuge.teak.core.model.TagOperationKind
import com.praveenjuge.teak.core.model.TagOperationStatus
import com.praveenjuge.teak.core.model.Tags
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The tag dialog that's open. */
data class TagEditor(val kind: TagOperationKind, val tag: TagCount) {
    /** "N cards, plus any in Archive or Trash", the reach every change states. */
    val scope: String get() = "${if (tag.cards == 1) "1 card" else "${tag.cards} cards"}, plus any in Archive or Trash"

    val title: String
        get() = when (kind) {
            TagOperationKind.Rename -> "Rename tag"
            TagOperationKind.Merge -> "Merge “${tag.name}” into…"
            TagOperationKind.Delete -> "Delete “${tag.name}”?"
        }

    val message: String
        get() = when (kind) {
            TagOperationKind.Rename -> "Renames “${tag.name}” on $scope."
            TagOperationKind.Merge -> "Cards tagged “${tag.name}” get the tag you pick instead. A card with both keeps one."
            TagOperationKind.Delete -> "Removes “${tag.name}” from $scope. The cards are kept. This can't be undone."
        }
}

data class TagsUiState(
    val isLoading: Boolean = true,
    val tags: List<TagCount> = emptyList(),
    val isComplete: Boolean = true,
    val query: String = "",
    val editor: TagEditor? = null,
    val editorError: String? = null,
    val operation: TagOperation? = null,
) {
    /** The list with a running or finished change already applied, since the summary catches up a little later. */
    val shown: List<TagCount>
        get() {
            val op = operation?.takeIf { it.status != TagOperationStatus.Failed } ?: return tags
            val fromKey = Tags.key(op.from)
            val moved = tags.firstOrNull { Tags.key(it.name) == fromKey } ?: return tags
            val rest = tags.filterNot { it === moved }
            val to = op.to?.trim().orEmpty()
            return when (op.kind) {
                TagOperationKind.Delete -> rest
                TagOperationKind.Rename, TagOperationKind.Merge -> {
                    val target = rest.firstOrNull { Tags.key(it.name) == Tags.key(to) }
                    val merged = TagCount(target?.name ?: to, (target?.count ?: 0.0) + moved.count)
                    (rest.filterNot { it === target } + merged).sortedWith(compareByDescending<TagCount> { it.count }.thenBy { it.name })
                }
            }
        }

    val visible: List<TagCount>
        get() = query.trim().takeIf { it.isNotEmpty() }?.let { q -> shown.filter { it.name.contains(q, ignoreCase = true) } } ?: shown
}

@HiltViewModel
class TagsViewModel @Inject constructor(
    private val repository: TagsRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(TagsUiState())
    val state: StateFlow<TagsUiState> = _state.asStateFlow()
    private var following: Job? = null
    private var requested = false

    init {
        repository.summary.onEach { result ->
            val summary = result.getOrNull()
            if (summary == null) {
                if (result.isSuccess && !requested) {
                    requested = true
                    catchingFailures { repository.requestSummary() }
                }
                _state.update { it.copy(isLoading = result.isSuccess) }
                return@onEach
            }
            _state.update {
                it.copy(
                    isLoading = false,
                    tags = summary.items.sortedWith(compareByDescending<TagCount> { tag -> tag.count }.thenBy { tag -> tag.name }),
                    isComplete = summary.isComplete,
                )
            }
        }.launchIn(viewModelScope)
    }

    fun search(query: String) = _state.update { it.copy(query = query) }

    fun open(kind: TagOperationKind, tag: TagCount) = _state.update { it.copy(editor = TagEditor(kind, tag), editorError = null) }

    fun closeEditor() = _state.update { it.copy(editor = null, editorError = null) }

    /** Why [name] can't be the new name, checked as the user types. */
    fun renameError(name: String): String? {
        val editor = _state.value.editor ?: return null
        Tags.explainInvalidName(name)?.let { return it }
        val existing = _state.value.tags.firstOrNull { Tags.key(it.name) == Tags.key(name) && Tags.key(it.name) != Tags.key(editor.tag.name) }
        return existing?.let { "A tag named “${it.name}” already exists." }
    }

    fun submit(to: String? = null) {
        val editor = _state.value.editor ?: return
        if (editor.kind == TagOperationKind.Rename) {
            val name = to.orEmpty()
            val existing = _state.value.tags.firstOrNull { Tags.key(it.name) == Tags.key(name) && Tags.key(it.name) != Tags.key(editor.tag.name) }
            if (existing != null) {
                return _state.update { it.copy(editorError = "A tag named “${existing.name}” already exists.") }
            }
            Tags.explainInvalidName(name)?.let { error -> return _state.update { it.copy(editorError = error) } }
        }
        start(editor.kind, editor.tag.name, to)
    }

    /** Takes the rename's suggestion: merge into [target], the tag that already has that name. */
    fun mergeInstead(target: String) {
        val editor = _state.value.editor ?: return
        start(TagOperationKind.Merge, editor.tag.name, target)
    }

    /** The tag already named [name], other than the one being renamed. */
    fun existingTag(name: String): String? {
        val editor = _state.value.editor ?: return null
        return _state.value.tags.firstOrNull { Tags.key(it.name) == Tags.key(name) && Tags.key(it.name) != Tags.key(editor.tag.name) }?.name
    }

    fun retry() {
        val operation = _state.value.operation ?: return
        start(operation.kind, operation.from, operation.to)
    }

    fun dismissOperation() = _state.update { if (it.operation?.status != TagOperationStatus.Running) it.copy(operation = null) else it }

    private fun start(kind: TagOperationKind, from: String, to: String?) {
        viewModelScope.launch {
            catchingFailures { repository.start(kind, from, to) }
                .onSuccess { operation ->
                    _state.update { it.copy(editor = null, editorError = null, operation = operation) }
                    follow(operation.id)
                }
                .onFailure { error ->
                    val message = (error as? TeakException)?.message ?: "Couldn't start the tag change"
                    _state.update { it.copy(editorError = message) }
                }
        }
    }

    /** Follows the running change until it completes or fails; the tag list updates on its own. */
    private fun follow(id: String) {
        following?.cancel()
        following = repository.operation(id)
            .transformWhile { result ->
                emit(result)
                result.getOrNull()?.status.let { it == null || it == TagOperationStatus.Running }
            }
            .onEach { result ->
                val op = result.getOrNull() ?: return@onEach
                _state.update { it.copy(operation = op) }
                if (op.status == TagOperationStatus.Completed) catchingFailures { repository.requestSummary() }
            }
            .launchIn(viewModelScope)
    }
}
