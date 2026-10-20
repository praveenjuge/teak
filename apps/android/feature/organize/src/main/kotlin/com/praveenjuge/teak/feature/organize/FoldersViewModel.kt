package com.praveenjuge.teak.feature.organize

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.model.Folder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** The folder dialog that's open: a new one, or editing [folder]. */
sealed interface FolderEditor {
    val smart: Boolean

    data class New(override val smart: Boolean) : FolderEditor
    data class Edit(val folder: Folder) : FolderEditor {
        override val smart: Boolean get() = folder.isSmart
    }

    val title: String
        get() = when (this) {
            is New -> if (smart) "Save as smart folder" else "New folder"
            is Edit -> if (smart) "Edit smart folder" else "Edit folder"
        }

    val submitLabel: String
        get() = when (this) {
            is New -> if (smart) "Save smart folder" else "Create folder"
            is Edit -> "Save"
        }
}

data class FolderNote(val id: Long, val text: String, val restoreId: String? = null)

data class FoldersUiState(
    val isLoading: Boolean = true,
    val failed: Boolean = false,
    val folders: List<Folder> = emptyList(),
    val editor: FolderEditor? = null,
    val editorError: String? = null,
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

    init {
        repository.folders.onEach { result ->
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
        val error = when {
            name.isBlank() -> "Name the folder"
            editor.smart && query.isNullOrBlank() -> "Add a search for the smart folder"
            else -> null
        }
        if (error != null) return _state.update { it.copy(editorError = error) }
        _state.update { it.copy(isSaving = true, editorError = null) }
        viewModelScope.launch {
            val smartQuery = if (editor.smart) query else null
            catchingFailures {
                when (editor) {
                    is FolderEditor.New -> repository.create(name, smartQuery)
                    is FolderEditor.Edit -> repository.update(editor.folder.id, name, smartQuery)
                }
            }
                .onSuccess { _state.update { it.copy(isSaving = false, editor = null) } }
                .onFailure { error ->
                    val fallback = if (editor is FolderEditor.New) "Couldn't create the folder" else "Couldn't save the folder"
                    _state.update { it.copy(isSaving = false, editorError = (error as? TeakException)?.message ?: fallback) }
                }
        }
    }

    /** Deletes right away, as the web does, with Undo in the note. */
    fun delete(folder: Folder) {
        viewModelScope.launch {
            catchingFailures { repository.delete(folder.id) }
                .onSuccess { post("Deleted “${folder.name}”. Its cards are still in your library.", restoreId = folder.id) }
                .onFailure { post("Couldn't delete the folder") }
        }
    }

    fun restore(note: FolderNote) {
        val id = note.restoreId ?: return
        dismissNote(note.id)
        viewModelScope.launch { catchingFailures { repository.restore(id) }.onFailure { post("Couldn't restore the folder") } }
    }

    fun dismissNote(id: Long) = _state.update { if (it.note?.id == id) it.copy(note = null) else it }

    private fun post(text: String, restoreId: String? = null) {
        noteId += 1
        _state.update { it.copy(note = FolderNote(noteId, text, restoreId)) }
    }
}
