package com.praveenjuge.teak.feature.card

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun CardDetailRoute(cardId: String, onBack: () -> Unit, onEdit: () -> Unit, onSearchTag: (String) -> Unit) {
    Text("Card $cardId")
}

@Composable
fun CardEditRoute(cardId: String, onDone: () -> Unit) {
    Text("Edit $cardId")
}

@Composable
fun CardDetailPlaceholder() {
    Text("Select a card")
}
