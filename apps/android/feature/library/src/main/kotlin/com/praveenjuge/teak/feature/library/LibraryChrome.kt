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
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Camera
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.ViewCarousel
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.InputChip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.DeleteSweep
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.BulkAction
import com.praveenjuge.teak.core.model.CardSort
import com.praveenjuge.teak.core.model.CardType
import com.praveenjuge.teak.core.model.ColorHue
import com.praveenjuge.teak.core.model.LibraryFilters
import com.praveenjuge.teak.core.model.QualifierChip
import com.praveenjuge.teak.core.model.SearchIsValue
import com.praveenjuge.teak.core.model.SearchQualifier
import com.praveenjuge.teak.core.model.SearchSuggestion

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun LibraryTopBar(
    title: String,
    isSelecting: Boolean,
    canSelect: Boolean,
    canRevisit: Boolean,
    sort: CardSort,
    scrollBehavior: TopAppBarScrollBehavior,
    onSelect: () -> Unit,
    onDone: () -> Unit,
    onSort: (CardSort) -> Unit,
    onRevisit: () -> Unit,
    onBack: (() -> Unit)?,
    onSaveSearch: (() -> Unit)? = null,
    /** Asks before emptying Trash; set only in Trash. */
    onEmptyTrash: (() -> Unit)? = null,
    canEmptyTrash: Boolean = false,
) {
    var sortOpen by rememberSaveable { mutableStateOf(false) }
    LargeFlexibleTopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() }) },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("common.back")) }
            }
        },
        actions = {
            if (isSelecting) {
                TextButton(onClick = onDone) { Text(tr("common.done")) }
                return@LargeFlexibleTopAppBar
            }
            if (canRevisit) {
                IconButton(onClick = onRevisit) { Icon(Icons.Outlined.ViewCarousel, contentDescription = tr("native.revisit.title")) }
            }
            if (onEmptyTrash != null) {
                IconButton(onClick = onEmptyTrash, enabled = canEmptyTrash) {
                    Icon(Icons.Outlined.DeleteSweep, contentDescription = tr("native.trash.empty"))
                }
            }
            Box {
                IconButton(onClick = { sortOpen = true }) {
                    Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = sortLabel(sort))
                }
                DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                    CardSort.entries.forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option.labelText.resolve()) },
                            leadingIcon = {
                                Icon(
                                    when (option) {
                                        CardSort.Newest -> Icons.Filled.ArrowDownward
                                        CardSort.Oldest -> Icons.Filled.ArrowUpward
                                        CardSort.Shuffle -> Icons.Filled.Shuffle
                                    },
                                    contentDescription = null,
                                )
                            },
                            trailingIcon = if (option == sort) ({ Icon(Icons.Filled.Check, contentDescription = tr("native.library.selected")) }) else null,
                            onClick = {
                                sortOpen = false
                                onSort(option)
                            },
                        )
                    }
                    if (onSaveSearch != null) {
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text(tr("native.library.menu.saveSmartFolder")) },
                            leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, contentDescription = null) },
                            onClick = {
                                sortOpen = false
                                onSaveSearch()
                            },
                        )
                    }
                }
            }
            IconButton(onClick = onSelect, enabled = canSelect) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = tr("native.library.selectCards"))
            }
        },
        scrollBehavior = scrollBehavior,
    )
}

/** The sort button's spoken name, like the web's "View: oldest first". */
@Composable
internal fun sortLabel(sort: CardSort): String = when (sort) {
    CardSort.Newest -> tr("native.library.sort.newest")
    CardSort.Oldest -> tr("native.library.sort.oldest")
    CardSort.Shuffle -> tr("native.library.sort.shuffle")
}

@Composable
internal fun LibrarySearchField(state: TextFieldState, modifier: Modifier = Modifier, onFocusChange: (Boolean) -> Unit = {}) {
    val focusManager = LocalFocusManager.current
    TextField(
        state = state,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).onFocusChanged { onFocusChange(it.isFocused) },
        placeholder = { Text(tr("native.library.search")) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (state.text.isNotEmpty()) {
            {
                IconButton(onClick = { state.clearText() }) {
                    Icon(Icons.Filled.Close, contentDescription = tr("native.library.clearSearch"))
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

/**
 * Which Favorites, Archive and Trash chips the filter row shows: all of them on phones, only one that's on
 * where the tablet rail has them (so it can be turned off), and none on those views' own pages.
 */
internal enum class ViewChips {
    All, Selected, None;

    fun shows(selected: Boolean): Boolean = this == All || (this == Selected && selected)
}

@Composable
internal fun LibraryFilterRow(
    filters: LibraryFilters,
    viewChips: ViewChips,
    canClear: Boolean,
    showsDone: Boolean,
    showsTodo: Boolean,
    onToggleFavorites: () -> Unit,
    onToggleArchive: () -> Unit,
    onToggleTrash: () -> Unit,
    onToggleDone: () -> Unit,
    onToggleTodo: () -> Unit,
    onToggleType: (CardType) -> Unit,
    onSelectHue: (ColorHue) -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (viewChips.shows(filters.favoritesOnly)) {
            FilterChip(
                selected = filters.favoritesOnly,
                onClick = onToggleFavorites,
                label = { Text(tr("native.filters.favorites")) },
                leadingIcon = { ChipIcon(if (filters.favoritesOnly) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder) },
            )
        }
        if (viewChips.shows(filters.archivedOnly)) {
            FilterChip(
                selected = filters.archivedOnly,
                onClick = onToggleArchive,
                label = { Text(tr("native.filters.archive")) },
                leadingIcon = { ChipIcon(Icons.Outlined.Archive) },
            )
        }
        if (viewChips.shows(filters.trashOnly)) {
            FilterChip(
                selected = filters.trashOnly,
                onClick = onToggleTrash,
                label = { Text(tr("native.filters.trash")) },
                leadingIcon = { ChipIcon(Icons.Outlined.Delete) },
            )
        }
        FilterChip(
            selected = showsDone,
            onClick = onToggleDone,
            label = { Text(tr("native.filters.is.done")) },
            leadingIcon = { ChipIcon(Icons.Outlined.CheckCircle) },
        )
        FilterChip(
            selected = showsTodo,
            onClick = onToggleTodo,
            label = { Text(tr("native.filters.is.todo")) },
            leadingIcon = { ChipIcon(Icons.Outlined.Circle) },
        )
        CardType.entries.forEach { type ->
            val selected = type in filters.types
            FilterChip(
                selected = selected,
                onClick = { onToggleType(type) },
                label = { Text(type.pluralText.resolve()) },
                leadingIcon = if (selected) ({ ChipIcon(Icons.Filled.Check) }) else null,
            )
        }
        ColorChip(filters.hue, onSelectHue)
        if (canClear) {
            AssistChip(onClick = onClear, label = { Text(tr("native.library.filter.clear")) }, leadingIcon = { ChipIcon(Icons.Filled.Close) })
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
            label = { Text(hue?.labelText?.resolve() ?: tr("native.library.menu.color")) },
            leadingIcon = hue?.let { { Swatch(it, size = FilterChipDefaults.IconSize.value.toInt()) } },
            trailingIcon = { ChipIcon(Icons.Filled.ArrowDropDown) },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            ColorHue.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.labelText.resolve()) },
                    leadingIcon = { Swatch(option) },
                    trailingIcon = if (option == hue) ({ Icon(Icons.Filled.Check, contentDescription = tr("native.library.selected")) }) else null,
                    onClick = {
                        expanded = false
                        onSelectHue(option)
                    },
                )
            }
        }
    }
}

/**
 * Hints for the word being typed, under the search field, as the web offers them: filters to start or
 * leave out ("Exclude"), `OR` ("Combine"), types and `is:` values. Picking one writes it into the search.
 */
@Composable
internal fun SearchSuggestionList(suggestions: List<SearchSuggestion>, onPick: (SearchSuggestion) -> Unit, modifier: Modifier = Modifier) {
    if (suggestions.isEmpty()) return
    val title = tr("native.search.suggestions")
    // Scrolls within a capped height, so a long list never pushes the cards off screen.
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(max = 320.dp)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .semantics { paneTitle = title },
    ) {
        suggestions.forEachIndexed { index, suggestion ->
            if (index == 0 || suggestions[index - 1].group != suggestion.group) {
                Text(
                    suggestion.groupText.resolve(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 2.dp).semantics { heading() },
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(CircleShape)
                    .clickable { onPick(suggestion) }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    suggestion.label.resolve(),
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = if (suggestion.complete) null else FontFamily.Monospace,
                    maxLines = 1,
                )
                suggestion.detail?.let { detail ->
                    Text(
                        detail.resolve(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Filters typed in the search, as removable chips: "Show · Archived", "Similar to · Desk lamp". */
@Composable
internal fun QualifierChipRow(chips: List<QualifierChip>, onRemove: (SearchQualifier) -> Unit, modifier: Modifier = Modifier) {
    if (chips.isEmpty()) return
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        chips.forEach { chip ->
            val removeLabel = chip.removeText.resolve()
            InputChip(
                selected = true,
                onClick = { onRemove(chip.qualifier) },
                label = {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurfaceVariant)) { append(chip.titleText.resolve()) }
                            append(" ")
                            append(chip.labelText.resolve())
                        },
                        maxLines = 1,
                    )
                },
                leadingIcon = { ChipIcon(qualifierIcon(chip.qualifier)) },
                trailingIcon = { ChipIcon(Icons.Filled.Close) },
                modifier = Modifier.semantics { contentDescription = removeLabel },
            )
        }
    }
}

private fun qualifierIcon(qualifier: SearchQualifier): ImageVector = when (qualifier) {
    is SearchQualifier.Tag -> Icons.Outlined.Sell
    is SearchQualifier.Type -> Icons.Outlined.FilterList
    is SearchQualifier.Is -> when (qualifier.state) {
        SearchIsValue.Archived -> Icons.Outlined.Archive
        SearchIsValue.Done -> Icons.Outlined.CheckCircle
        SearchIsValue.Todo -> Icons.Outlined.Circle
        SearchIsValue.Favorite -> Icons.Outlined.FavoriteBorder
    }
    is SearchQualifier.Site -> Icons.Outlined.Language
    is SearchQualifier.Folder -> Icons.Outlined.Folder
    is SearchQualifier.Like -> Icons.Outlined.AutoAwesome
    is SearchQualifier.Mood -> Icons.Outlined.Camera
    is SearchQualifier.Price -> Icons.Outlined.Payments
    is SearchQualifier.Text -> Icons.Outlined.DocumentScanner
}

internal enum class SelectionView { Library, Archive, Trash }

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun SelectionToolbar(
    view: SelectionView,
    enabled: Boolean,
    onAction: (BulkAction) -> Unit,
    onAddTags: () -> Unit,
    onAddToFolder: () -> Unit,
    onDeleteForever: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var moreOpen by rememberSaveable { mutableStateOf(false) }
    HorizontalFloatingToolbar(expanded = true, modifier = modifier) {
        when (view) {
            SelectionView.Trash -> {
                ToolbarAction(tr("native.actions.restore"), Icons.AutoMirrored.Filled.Undo, enabled, destructive = false) { onAction(BulkAction.Restore) }
                ToolbarAction(tr("native.actions.deleteForever"), Icons.Outlined.DeleteForever, enabled, destructive = true, onClick = onDeleteForever)
                return@HorizontalFloatingToolbar
            }
            SelectionView.Archive ->
                ToolbarAction(tr("native.actions.unarchive"), Icons.Outlined.Unarchive, enabled, destructive = false) { onAction(BulkAction.Unarchive) }
            SelectionView.Library ->
                ToolbarAction(tr("native.actions.archive"), Icons.Outlined.Archive, enabled, destructive = false) { onAction(BulkAction.Archive) }
        }
        Box {
            IconButton(onClick = { moreOpen = true }, enabled = enabled) {
                Icon(Icons.Outlined.MoreVert, contentDescription = tr("native.bulk.moreActions"))
            }
            DropdownMenu(expanded = moreOpen, onDismissRequest = { moreOpen = false }) {
                fun item(label: String, icon: ImageVector, destructive: Boolean = false, onClick: () -> Unit): @Composable () -> Unit = {
                    val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                    DropdownMenuItem(
                        text = { Text(label, color = color) },
                        leadingIcon = { Icon(icon, contentDescription = null, tint = color) },
                        onClick = {
                            moreOpen = false
                            onClick()
                        },
                    )
                }
                item(tr("native.bulk.addToFavorites"), Icons.Outlined.FavoriteBorder) { onAction(BulkAction.Favorite) }()
                item(tr("native.bulk.removeFromFavorites"), Icons.Outlined.HeartBroken) { onAction(BulkAction.Unfavorite) }()
                HorizontalDivider()
                item(tr("native.bulk.addTagsEllipsis"), Icons.Outlined.Sell, onClick = onAddTags)()
                item(tr("native.bulk.addToFolderEllipsis"), Icons.Outlined.CreateNewFolder, onClick = onAddToFolder)()
                HorizontalDivider()
                item(tr("native.actions.moveToTrash"), Icons.Outlined.Delete, destructive = true) { onAction(BulkAction.Delete) }()
            }
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
