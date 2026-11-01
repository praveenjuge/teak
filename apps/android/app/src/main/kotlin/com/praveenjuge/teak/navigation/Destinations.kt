package com.praveenjuge.teak.navigation

import androidx.navigation3.runtime.NavKey
import com.praveenjuge.teak.core.data.repository.LibraryView
import kotlinx.serialization.Serializable

@Serializable data object Home : NavKey
@Serializable data class ViewLibrary(val view: LibraryView) : NavKey
@Serializable data class CardDetail(val id: String) : NavKey
@Serializable data class CardEdit(val id: String) : NavKey
@Serializable data class PdfViewer(val cardId: String) : NavKey
@Serializable data object Add : NavKey
@Serializable data class NoteComposer(val text: String = "") : NavKey
@Serializable data object VoiceMemo : NavKey
@Serializable data object Settings : NavKey
@Serializable data object Folders : NavKey
@Serializable data class FolderLibrary(val id: String) : NavKey
@Serializable data object TagManager : NavKey
