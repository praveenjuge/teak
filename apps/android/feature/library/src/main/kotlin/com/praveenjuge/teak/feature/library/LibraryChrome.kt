package com.praveenjuge.teak.feature.library

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import com.praveenjuge.teak.core.model.LibraryFilters

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun LibraryTopBar(
    title: String,
    isSelecting: Boolean,
    canSelect: Boolean,
    scrollBehavior: TopAppBarScrollBehavior,
    onSelect: () -> Unit,
    onDone: () -> Unit,
) {
    LargeFlexibleTopAppBar(
        title = { Text(title, modifier = Modifier.semantics { heading() }) },
        actions = {
            if (isSelecting) {
                TextButton(onClick = onDone) { Text("Done") }
            } else {
                IconButton(onClick = onSelect, enabled = canSelect) {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = "Select cards")
                }
            }
        },
        scrollBehavior = scrollBehavior,
    )
}

@Composable
internal fun LibrarySearchField(state: TextFieldState, modifier: Modifier = Modifier) {
    val focusManager = LocalFocusManager.current
    TextField(
        state = state,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        placeholder = { Text("Search") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (state.text.isNotEmpty()) {
            {
                IconButton(onClick = { state.clearText() }) {
                    Icon(Icons.Filled.Close, contentDescription = "Clear search")
                }
            }
        } else {
            null
        },
        lineLimits = TextFieldLineLimits.SingleLine,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, imeAction = ImeAction.Search),
        onKeyboardAction = { focusManager.clearFocus() },
        shape = CircleShape,
        colors = TextFieldDefaults.colors(
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent,
        ),
    )
}

/** Favorites, Trash, one chip per type, a color picker, and Clear when anything is on. */
@Composable
internal fun LibraryFilterRow(
    filters: LibraryFilters,
    onToggleFavorites: () -> Unit,
    onToggleTrash: () -> Unit,
    onToggleType: (CardType) -> Unit,
    onSelectHue: (ColorHue) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterChip(
            selected = filters.favoritesOnly,
            onClick = onToggleFavorites,
            label = { Text("Favorites") },
            leadingIcon = { ChipIcon(if (filters.favoritesOnly) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder) },
        )
        FilterChip(
            selected = filters.trashOnly,
            onClick = onToggleTrash,
            label = { Text("Trash") },
            leadingIcon = { ChipIcon(Icons.Outlined.Delete) },
        )
        CardType.entries.forEach { type ->
            val selected = type in filters.types
            FilterChip(
                selected = selected,
                onClick = { onToggleType(type) },
                label = { Text(type.plural) },
                leadingIcon = if (selected) ({ ChipIcon(Icons.Filled.Check) }) else null,
            )
        }
        ColorChip(filters.hue, onSelectHue)
        if (filters.isActive) {
            AssistChip(onClick = onClear, label = { Text("Clear") }, leadingIcon = { ChipIcon(Icons.Filled.Close) })
        }
    }
}

@Composable
private fun ChipIcon(icon: ImageVector) {
    Icon(icon, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize))
}

@Composable
private fun Swatch(hue: ColorHue, size: Int = 18) {
    Box(Modifier.size(size.dp).background(Color(hue.hex), CircleShape))
}

@Composable
private fun ColorChip(hue: ColorHue?, onSelectHue: (ColorHue) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Box {
        FilterChip(
            selected = hue != null,
            onClick = { expanded = true },
            label = { Text(hue?.label ?: "Color") },
            leadingIcon = hue?.let { { Swatch(it, size = FilterChipDefaults.IconSize.value.toInt()) } },
            trailingIcon = { ChipIcon(Icons.Filled.ArrowDropDown) },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            ColorHue.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    leadingIcon = { Swatch(option) },
                    trailingIcon = if (option == hue) ({ Icon(Icons.Filled.Check, contentDescription = "Selected") }) else null,
                    onClick = {
                        expanded = false
                        onSelectHue(option)
                    },
                )
            }
        }
    }
}

/** The floating actions while selecting: Move to Trash, or Restore and Delete Forever in Trash. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun SelectionToolbar(
    inTrash: Boolean,
    enabled: Boolean,
    onMoveToTrash: () -> Unit,
    onRestore: () -> Unit,
    onDeleteForever: () -> Unit,
    modifier: Modifier = Modifier,
) {
    HorizontalFloatingToolbar(expanded = true, modifier = modifier) {
        if (inTrash) {
            ToolbarAction("Restore", Icons.AutoMirrored.Filled.Undo, enabled, destructive = false, onClick = onRestore)
            ToolbarAction("Delete Forever", Icons.Outlined.DeleteForever, enabled, destructive = true, onClick = onDeleteForever)
        } else {
            ToolbarAction("Move to Trash", Icons.Outlined.Delete, enabled, destructive = true, onClick = onMoveToTrash)
        }
    }
}

@Composable
private fun ToolbarAction(label: String, icon: ImageVector, enabled: Boolean, destructive: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        colors = if (destructive) {
            ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
        } else {
            ButtonDefaults.textButtonColors()
        },
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text(label)
    }
}
