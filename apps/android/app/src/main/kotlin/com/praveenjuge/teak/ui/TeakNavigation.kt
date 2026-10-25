package com.praveenjuge.teak.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.feature.capture.AddRoute
import com.praveenjuge.teak.feature.capture.NoteComposerRoute
import com.praveenjuge.teak.feature.capture.VoiceMemoRoute
import com.praveenjuge.teak.feature.card.CardDetailPlaceholder
import com.praveenjuge.teak.feature.card.CardDetailRoute
import com.praveenjuge.teak.feature.card.CardEditRoute
import com.praveenjuge.teak.core.model.SearchQualifier
import com.praveenjuge.teak.core.model.SearchQuery
import com.praveenjuge.teak.feature.library.LibraryRoute
import com.praveenjuge.teak.feature.organize.FoldersRoute
import com.praveenjuge.teak.feature.organize.TagsRoute
import com.praveenjuge.teak.navigation.FolderLibrary
import com.praveenjuge.teak.navigation.Folders
import com.praveenjuge.teak.navigation.TagManager
import com.praveenjuge.teak.feature.settings.SettingsRoute
import com.praveenjuge.teak.navigation.Add
import com.praveenjuge.teak.navigation.CardDetail
import com.praveenjuge.teak.navigation.CardEdit
import com.praveenjuge.teak.navigation.Home
import com.praveenjuge.teak.navigation.NoteComposer
import com.praveenjuge.teak.navigation.Settings
import com.praveenjuge.teak.navigation.VoiceMemo

private enum class Tab(val selected: ImageVector, val unselected: ImageVector) {
    Home(Icons.Filled.Home, Icons.Outlined.Home),
    Folders(Icons.Filled.Folder, Icons.Outlined.Folder),
    Add(Icons.Filled.AddCircle, Icons.Outlined.AddCircleOutline),
    Settings(Icons.Filled.Settings, Icons.Outlined.Settings),
}

@Composable
private fun Tab.label(): String = when (this) {
    Tab.Home -> tr("native.app.nav.home")
    Tab.Folders -> tr("native.app.nav.folders")
    Tab.Add -> tr("native.app.nav.add")
    Tab.Settings -> tr("native.app.nav.settings")
}

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun TeakNavigation(launchRequest: LaunchRequest?, onLaunchRequestHandled: () -> Unit) {
    val stacks = mapOf(
        Tab.Home to rememberNavBackStack(Home),
        Tab.Folders to rememberNavBackStack(Folders),
        Tab.Add to rememberNavBackStack(Add),
        Tab.Settings to rememberNavBackStack(Settings),
    )
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var searchRequest by rememberSaveable { mutableStateOf<String?>(null) }
    val backStack = stacks.getValue(tab)
    val activity = LocalActivity.current

    LaunchedEffect(launchRequest) {
        when (launchRequest) {
            LaunchRequest.NewNote -> {
                tab = Tab.Add
                stacks.getValue(Tab.Add).resetTo(Add, NoteComposer())
            }
            LaunchRequest.VoiceMemo -> {
                tab = Tab.Add
                stacks.getValue(Tab.Add).resetTo(Add, VoiceMemo)
            }
            null -> return@LaunchedEffect
        }
        onLaunchRequestHandled()
    }

    fun searchHome(search: String) {
        searchRequest = search
        stacks.getValue(Tab.Home).resetTo(Home)
        tab = Tab.Home
    }

    // NavDisplay only handles Back when its stack has more than one entry. On another tab's first
    // screen, Back returns to Home, as on iOS, instead of closing the app.
    BackHandler(enabled = tab != Tab.Home && backStack.size <= 1) { tab = Tab.Home }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            Tab.entries.forEach { item ->
                item(
                    selected = tab == item,
                    onClick = {
                        if (tab == item) stacks.getValue(item).resetTo(stacks.getValue(item).first()) else tab = item
                    },
                    icon = { Icon(if (tab == item) item.selected else item.unselected, contentDescription = null) },
                    label = { Text(item.label()) },
                )
            }
        },
    ) {
        NavDisplay(
            backStack = backStack,
            onBack = {
                when {
                    backStack.size > 1 -> backStack.removeLastOrNull()
                    tab != Tab.Home -> tab = Tab.Home
                    else -> activity?.finish()
                }
            },
            entryDecorators = listOf(
                rememberSaveableStateHolderNavEntryDecorator<NavKey>(),
                rememberViewModelStoreNavEntryDecorator<NavKey>(),
            ),
            sceneStrategies = listOf(rememberListDetailSceneStrategy<NavKey>()),
            entryProvider = entryProvider<NavKey> {
                entry<Home>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { CardDetailPlaceholder() })) {
                    LibraryRoute(
                        searchRequest = searchRequest,
                        onSearchRequestHandled = { searchRequest = null },
                        selectedCardId = (backStack.lastOrNull() as? CardDetail)?.id,
                        onOpenCard = { id -> backStack.replaceDetail(CardDetail(id)) },
                        onWriteNote = { backStack.push(NoteComposer()) },
                    )
                }
                entry<Folders> { FoldersRoute(onOpenFolder = { id -> backStack.push(FolderLibrary(id)) }) }
                entry<FolderLibrary>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { CardDetailPlaceholder() })) { key ->
                    LibraryRoute(
                        folderId = key.id,
                        searchRequest = null,
                        onSearchRequestHandled = {},
                        selectedCardId = (backStack.lastOrNull() as? CardDetail)?.id,
                        onOpenCard = { id -> backStack.replaceDetail(CardDetail(id)) },
                        onWriteNote = { backStack.push(NoteComposer()) },
                        onBack = { backStack.remove(key) },
                    )
                }
                entry<CardDetail>(metadata = ListDetailSceneStrategy.detailPane()) { key ->
                    CardDetailRoute(
                        cardId = key.id,
                        onBack = { backStack.remove(key) },
                        onEdit = { backStack.push(CardEdit(key.id)) },
                        onSearchTag = { tag -> searchHome(tag) },
                        onMoreLikeThis = { id -> searchHome("like:$id") },
                        onOpenCard = { id -> backStack.add(CardDetail(id)) },
                    )
                }
                entry<CardEdit>(metadata = ListDetailSceneStrategy.extraPane()) { key ->
                    CardEditRoute(cardId = key.id, onDone = { backStack.remove(key) })
                }
                entry<Add> {
                    AddRoute(
                        onWriteNote = { backStack.push(NoteComposer()) },
                        onRecordVoice = { backStack.push(VoiceMemo) },
                    )
                }
                entry<NoteComposer> { key ->
                    NoteComposerRoute(initialText = key.text, onDone = { backStack.remove(key) })
                }
                entry<VoiceMemo> { key ->
                    VoiceMemoRoute(onDone = { backStack.remove(key) })
                }
                entry<Settings> { SettingsRoute(onManageTags = { backStack.push(TagManager) }) }
                entry<TagManager> {
                    TagsRoute(
                        onBack = { backStack.removeLastOrNull() },
                        onOpenTag = { tag -> searchHome(SearchQuery.format(SearchQualifier.Tag(tag))) },
                    )
                }
            },
        )
    }
}

/** Replaces the stack's contents, keeping at least one entry so NavDisplay always has a screen. */
private fun NavBackStack<NavKey>.resetTo(vararg keys: NavKey) {
    addAll(keys)
    repeat(size - keys.size) { removeAt(0) }
}

/**
 * Adds [key] unless it's already showing, so a double tap can't stack two copies of a screen.
 * Two equal keys would also share saved state, so closing one would leave the other on screen.
 */
private fun NavBackStack<NavKey>.push(key: NavKey) {
    if (lastOrNull() != key) add(key)
}

private fun NavBackStack<NavKey>.replaceDetail(key: CardDetail) {
    while (lastOrNull() is CardEdit || lastOrNull() is CardDetail) removeLastOrNull()
    add(key)
}
