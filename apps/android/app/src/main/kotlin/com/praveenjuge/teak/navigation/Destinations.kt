package com.praveenjuge.teak.navigation

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

@Serializable data object Home : NavKey
@Serializable data class CardDetail(val id: String) : NavKey
@Serializable data class CardEdit(val id: String) : NavKey
@Serializable data object Add : NavKey
@Serializable data class NoteComposer(val text: String = "") : NavKey
@Serializable data object VoiceMemo : NavKey
@Serializable data object Settings : NavKey
