package com.praveenjuge.teak.feature.library

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

/** The library grid. Placeholder until the library feature lands. */
@Composable
fun LibraryRoute(
    searchRequest: String?,
    onSearchRequestHandled: () -> Unit,
    selectedCardId: String?,
    onOpenCard: (String) -> Unit,
    onWriteNote: () -> Unit,
) {
    Text("Library")
}
