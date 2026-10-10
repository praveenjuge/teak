package com.praveenjuge.teak.core.designsystem.component

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** The expressive loading indicator, centered in the available space. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TeakLoading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        LoadingIndicator(Modifier.semantics { contentDescription = "Loading" })
    }
}
