package com.praveenjuge.teak.feature.library

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ViewCarousel
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.luminance
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.repository.CardQuery
import com.praveenjuge.teak.core.designsystem.component.EmptyState
import com.praveenjuge.teak.core.designsystem.component.TeakLoading
import com.praveenjuge.teak.core.model.CardSummary
import com.praveenjuge.teak.core.model.CardType
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.abs

private val SwipeThreshold = 96.dp

/** What a key does in the deck, as on the web: ← or A archives, → or K keeps, Space opens, Z undoes. */
internal enum class RevisitKey { Archive, Keep, Open, Undo }

internal fun revisitKeyAction(key: Key): RevisitKey? = when (key) {
    Key.DirectionLeft, Key.A -> RevisitKey.Archive
    Key.DirectionRight, Key.K -> RevisitKey.Keep
    Key.Spacebar -> RevisitKey.Open
    Key.Z -> RevisitKey.Undo
    else -> null
}

@Composable
internal fun RevisitRoute(view: CardQuery, onOpenCard: (String) -> Unit, onClose: () -> Unit) {
    val viewModel: RevisitViewModel = hiltViewModel(key = "revisit")
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(view) { viewModel.start(view) }
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // The dialog draws behind the status bar; give it icons that read on the deck's background.
        val view = LocalView.current
        val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
        SideEffect {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
            }
        }
        RevisitDeck(
            state = state,
            onArchive = viewModel::archive,
            onKeep = viewModel::keep,
            onUndo = viewModel::undo,
            onDealAgain = viewModel::deal,
            onNoteShown = viewModel::noteShown,
            onOpenCard = onOpenCard,
            onClose = onClose,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun RevisitDeck(
    state: RevisitUiState,
    onArchive: () -> Unit,
    onKeep: () -> Unit,
    onUndo: () -> Unit,
    onDealAgain: () -> Unit,
    onNoteShown: () -> Unit,
    onOpenCard: (String) -> Unit,
    onClose: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(state.archivedNote) {
        if (state.archivedNote == null) return@LaunchedEffect
        val result = snackbarHostState.showSnackbar("Archived 1 card", actionLabel = "Undo", duration = SnackbarDuration.Long)
        if (result == SnackbarResult.ActionPerformed) onUndo() else onNoteShown()
    }
    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown || event.isCtrlPressed || event.isMetaPressed || event.isAltPressed) {
                    return@onPreviewKeyEvent false
                }
                when (revisitKeyAction(event.key)) {
                    RevisitKey.Archive -> onArchive()
                    RevisitKey.Keep -> onKeep()
                    RevisitKey.Open -> state.current?.let { onOpenCard(it.id) }
                    RevisitKey.Undo -> onUndo()
                    null -> if (event.key == Key.Escape) onClose() else return@onPreviewKeyEvent false
                }
                true
            },
        topBar = {
            Column {
                TopAppBar(
                    title = { Text("Revisit") },
                    navigationIcon = {
                        IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close Revisit") }
                    },
                    actions = {
                        if (state.cards.isNotEmpty() && !state.isFinished) {
                            Text(state.progress, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(end = 8.dp))
                        }
                        IconButton(onClick = onUndo, enabled = state.canUndo) {
                            Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Undo")
                        }
                    },
                )
                if (state.cards.isNotEmpty()) {
                    LinearProgressIndicator(
                        progress = { state.position.toFloat() / state.cards.size },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
            val current = state.current
            when {
                state.isLoading -> TeakLoading()
                state.failed -> EmptyState(
                    title = "Couldn't load cards",
                    message = "Check your connection and try again.",
                    icon = Icons.Outlined.CloudOff,
                    action = { Button(onClick = onDealAgain) { Text("Retry") } },
                )
                state.isEmpty -> EmptyState(
                    title = "Nothing to revisit here",
                    message = "Cards you save show up here to look back on.",
                    icon = Icons.Outlined.ViewCarousel,
                    action = { Button(onClick = onClose) { Text("Done") } },
                )
                state.isFinished -> DeckEnd(state, onDealAgain, onClose)
                current != null -> key(current.id) {
                    DeckCard(current, archiving = state.archivingId == current.id, onArchive, onKeep, onOpenCard)
                }
            }
        }
    }
}

@Composable
private fun DeckCard(
    card: CardSummary,
    archiving: Boolean,
    onArchive: () -> Unit,
    onKeep: () -> Unit,
    onOpenCard: (String) -> Unit,
) {
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val threshold = with(LocalDensity.current) { SwipeThreshold.toPx() }
    Column(
        Modifier.widthIn(max = 480.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            when {
                offset.value <= -threshold -> "Release to archive"
                offset.value >= threshold -> "Release to keep"
                else -> "Swipe left to archive, right to keep"
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Box(
            Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    translationX = offset.value
                    rotationZ = offset.value / 40f
                    alpha = 1f - (abs(offset.value) / (threshold * 4)).coerceAtMost(0.5f)
                }
                .pointerInput(card.id) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            val value = offset.value
                            scope.launch {
                                when {
                                    value <= -threshold -> onArchive()
                                    value >= threshold -> onKeep()
                                }
                                offset.animateTo(0f)
                            }
                        },
                        onDragCancel = { scope.launch { offset.animateTo(0f) } },
                        onHorizontalDrag = { change, delta ->
                            change.consume()
                            scope.launch { offset.snapTo(offset.value + delta) }
                        },
                    )
                }
                .semantics {
                    customActions = listOf(
                        CustomAccessibilityAction("Archive") { onArchive(); true },
                        CustomAccessibilityAction("Keep") { onKeep(); true },
                    )
                },
        ) {
            CardTile(
                card = card,
                selection = TileSelection.NotSelecting,
                highlighted = false,
                onClick = { onOpenCard(card.id) },
                onLongClick = {},
            )
        }
        Text(
            "${if (card.type == CardType.Text) "Note" else card.type.label} · Saved ${savedDate(card.creationTime)}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = onArchive, enabled = !archiving) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
                Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                Text("Archive")
            }
            Button(onClick = onKeep) {
                Text("Keep")
                Spacer(Modifier.width(ButtonDefaults.IconSpacing))
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, modifier = Modifier.size(ButtonDefaults.IconSize))
            }
        }
    }
}

@Composable
private fun DeckEnd(state: RevisitUiState, onDealAgain: () -> Unit, onClose: () -> Unit) {
    Column(
        Modifier.padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(48.dp))
        Text("All caught up", style = MaterialTheme.typography.headlineSmall)
        Text(state.summary, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (state.steps.any { it.archived }) {
            Text(
                "Z undoes the last archive",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = onDealAgain) {
                Text(if (state.cards.size >= RevisitViewModel.DECK_SIZE) "Revisit ${RevisitViewModel.DECK_SIZE} more" else "Start over")
            }
            Button(onClick = onClose) { Text("Done") }
        }
    }
}

private fun savedDate(epochMillis: Double): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
        .withZone(ZoneId.systemDefault())
        .format(Instant.ofEpochMilli(epochMillis.toLong()))
