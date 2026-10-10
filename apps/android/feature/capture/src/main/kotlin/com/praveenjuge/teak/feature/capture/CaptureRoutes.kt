package com.praveenjuge.teak.feature.capture

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun AddRoute(onWriteNote: () -> Unit, onRecordVoice: () -> Unit) {
    Text("Add")
}

@Composable
fun NoteComposerRoute(initialText: String, onDone: () -> Unit) {
    Text("Note")
}

@Composable
fun VoiceMemoRoute(onDone: () -> Unit) {
    Text("Voice")
}
