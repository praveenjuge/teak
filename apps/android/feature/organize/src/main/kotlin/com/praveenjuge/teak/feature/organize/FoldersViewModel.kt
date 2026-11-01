package com.praveenjuge.teak.feature.organize

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.teakText
import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.UiText
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface FolderEditor {
    val smart: Boolean

    data class New(override val smart: Boolean) : FolderEditor
    data class Edit(val folder: Folder) : FolderEditor {
        override val smart: Boolean get() = folder.isSmart
    }

    val title: UiText
        get() = when (this) {
            is New -> if (smart) UiText.of("native.folders.saveAsSmartFolder") else UiText.of("native.folders.newFolder")
            is Edit -> if (smart) UiText.of("native.folders.editSmartFolder") else UiText.of("native.folders.editFolder")
        }

    val submitLabel: UiText
        get() = when (this) {
            is New -> if (smart) UiText.of("native.folders.saveSmartFolder") else UiText.of("native.folders.createFolder")
            is Edit -> UiText.of("common.save")
        }
}

data class FolderNote(val id: Long, val text: UiText, val restoreId: String? = null)

data class FoldersUiState(
    val isLoading: Boolean = true,
    val failed: Boolean = false,
    val folders: List<Folder> = emptyList(),
    val editor: FolderEditor? = null,
    val editorError: UiText? = null,
    val isSaving: Boolean = false,
    val note: FolderNote? = null,
)

@HiltViewModel
class FoldersViewModel @Inject constructor(
    private val repository: FoldersRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(FoldersUiState())
    val state: StateFlow<FoldersUiState> = _state.asStateFlow()
    private var noteId = 0L
    private var loading: Job? = null

    init {
        load()
    }

    fun reload() {
        _state.update { it.copy(isLoading = true, failed = false) }
        load()
    }

    private fun load() {
        loading?.cancel()
        loading = repository.folders.onEach { result ->
            _state.update { state ->
                result.fold(
                    onSuccess = { state.copy(isLoading = false, failed = false, folders = it.sortedBy { folder -> folder.name.lowercase() }) },
                    onFailure = { state.copy(isLoading = false, failed = state.folders.isEmpty()) },
                )
            }
        }.launchIn(viewModelScope)
    }

    fun open(editor: FolderEditor) = _state.update { it.copy(editor = editor, editorError = null) }

    fun closeEditor() = _state.update { it.copy(editor = null, editorError = null) }

    fun save(name: String, query: String?) {
        val editor = _state.value.editor ?: return
        if (_state.value.isSaving) return
        val trimmedName = name.trim()
        val trimmedQuery = query?.trim()
        val error = when {
            trimmedName.isEmpty() -> UiText.of("errors.folders.EMPTY_NAME")
            editor.smart && trimmedQuery.isNullOrEmpty() -> UiText.of("errors.folders.EMPTY_QUERY")
            else -> null
        }
        if (error != null) return _state.update { it.copy(editorError = error) }
        _state.update { it.copy(isSaving = true, editorError = null) }
        viewModelScope.launch {
            val smartQuery = if (editor.smart) trimmedQuery else null
            catchingFailures {
                when (editor) {
                    is FolderEditor.New -> repository.create(trimmedName, smartQuery)
                    is FolderEditor.Edit -> repository.update(editor.folder.id, trimmedName, smartQuery)
                }
            }
                .onSuccess { _state.update { it.copy(isSaving = false, editor = null) } }
                .onFailure { error ->
                    val fallback = if (editor is FolderEditor.New) {
                        UiText.of("native.folders.createFailed")
                    } else {
                        UiText.of("native.folders.saveFailed")
                    }
                    val message = error.teakText(fallback)
                    _state.update { it.copy(isSaving = false, editorError = message) }
                }
        }
    }

    /** Deletes right away, as the web does, with Undo in the note. */
    fun delete(folder: Folder) {
        viewModelScope.launch {
            catchingFailures { repository.delete(folder.id) }
                .onSuccess { post(UiText.of("native.folders.deletedName", folder.name), restoreId = folder.id) }
                .onFailure { post(UiText.of("native.folders.deleteFailed")) }
        }
    }

    fun restore(note: FolderNote) {
        val id = note.restoreId ?: return
        dismissNote(note.id)
        viewModelScope.launch { catchingFailures { repository.restore(id) }.onFailure { post(UiText.of("native.folders.restoreFailed")) } }
    }

    fun dismissNote(id: Long) = _state.update { if (it.note?.id == id) it.copy(note = null) else it }

    private fun post(text: UiText, restoreId: String? = null) {
        noteId += 1
        _state.update { it.copy(note = FolderNote(noteId, text, restoreId)) }
    }
}
