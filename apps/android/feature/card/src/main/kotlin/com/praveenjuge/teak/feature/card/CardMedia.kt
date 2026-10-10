package com.praveenjuge.teak.feature.card

import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import coil3.compose.AsyncImage
import com.praveenjuge.teak.core.model.CardGrid
import com.praveenjuge.teak.core.model.CardSheet
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import androidx.media3.ui.compose.material3.Player as MediaPlayer

internal val MAX_MEDIA_HEIGHT = 440.dp
private val PLACEHOLDER_HEIGHT = 200.dp
internal val MediaShape = RoundedCornerShape(20.dp)

/** Width over height from saved dimensions, or null when they're missing. */
internal fun mediaRatio(width: Double?, height: Double?): Float? =
    if (width != null && height != null && width > 0 && height > 0) (width / height).toFloat() else null

/**
 * An image as wide as the screen and capped in height. It tries [primaryUrl], then [fallbackUrl],
 * then shows [placeholderIcon] and [placeholderLabel]. With [onOpen] a tap opens it full screen.
 */
@Composable
internal fun MediaImage(
    primaryUrl: String?,
    fallbackUrl: String?,
    ratio: Float?,
    contentDescription: String?,
    placeholderIcon: ImageVector,
    placeholderLabel: String,
    modifier: Modifier = Modifier,
    onOpen: ((String) -> Unit)? = null,
) {
    val urls = remember(primaryUrl, fallbackUrl) { listOfNotNull(primaryUrl, fallbackUrl).distinct() }
    var attempt by remember(urls) { mutableStateOf(0) }
    val url = urls.getOrNull(attempt)
    if (url == null) {
        MediaPlaceholder(placeholderIcon, placeholderLabel, modifier)
        return
    }
    val tappable = if (onOpen != null) {
        Modifier.clickable(onClickLabel = "View full screen") { onOpen(url) }
    } else {
        Modifier
    }
    MediaFrame(ratio, modifier) { frame ->
        AsyncImage(
            model = url,
            contentDescription = contentDescription,
            contentScale = if (ratio != null) ContentScale.Crop else ContentScale.FillWidth,
            onError = { attempt += 1 },
            modifier = frame.then(tappable),
        )
    }
}

/** Sizes media to the full width at [ratio], capped at [MAX_MEDIA_HEIGHT]. Unknown ratios size to the content. */
@Composable
internal fun MediaFrame(ratio: Float?, modifier: Modifier = Modifier, content: @Composable (Modifier) -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val frame = if (ratio != null) {
            val height = min(maxWidth / ratio, MAX_MEDIA_HEIGHT)
            val width = min(maxWidth, height * ratio)
            Modifier.size(width, height)
        } else {
            Modifier.fillMaxWidth().heightIn(max = MAX_MEDIA_HEIGHT)
        }
        content(frame.clip(MediaShape))
    }
}

@Composable
internal fun MediaPlaceholder(icon: ImageVector, label: String, modifier: Modifier = Modifier, height: Dp = PLACEHOLDER_HEIGHT) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = height)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, MediaShape)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(32.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A full-screen image you can pinch to zoom, drag, and double-tap to reset. */
@Composable
internal fun ImageViewer(url: String, contentDescription: String?, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        var scale by remember { mutableFloatStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }
        val transform = rememberTransformableState { zoom, pan, _ ->
            scale = (scale * zoom).coerceIn(1f, 5f)
            offset = if (scale == 1f) Offset.Zero else offset + pan
        }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AsyncImage(
                model = url,
                contentDescription = contentDescription,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = {
                            scale = if (scale > 1f) 1f else 2.5f
                            offset = Offset.Zero
                        })
                    }
                    .transformable(transform)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                    },
            )
            IconButton(
                onClick = onDismiss,
                colors = IconButtonDefaults.iconButtonColors(containerColor = Color.Black.copy(alpha = 0.5f), contentColor = Color.White),
                modifier = Modifier.align(Alignment.TopStart).safeDrawingPadding().padding(8.dp),
            ) {
                Icon(Icons.Filled.Close, contentDescription = "Close")
            }
        }
    }
}

/** An ExoPlayer for [url] that lives as long as the composable and pauses when the app leaves the screen. */
@Composable
private fun rememberPlayer(url: String): ExoPlayer {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { player.pause() }
    return player
}

/** Video with the Material player controls; the poster shows until the first frame is ready. */
@OptIn(UnstableApi::class)
@Composable
internal fun VideoPlayer(url: String, posterUrl: String?, ratio: Float?, modifier: Modifier = Modifier) {
    val player = rememberPlayer(url)
    MediaFrame(ratio ?: (16f / 9f), modifier) { frame ->
        MediaPlayer(
            player = player,
            modifier = frame.background(Color.Black),
            shutter = {
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    if (posterUrl != null) {
                        AsyncImage(
                            model = posterUrl,
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            },
        )
    }
}

/** A play button, the card's waveform filling with progress, and the time. */
@Composable
internal fun AudioPlayer(cardId: String, url: String?, savedDuration: Double?, modifier: Modifier = Modifier) {
    if (url == null) {
        MediaPlaceholder(Icons.Outlined.GraphicEq, "Audio unavailable", modifier)
        return
    }
    val player = rememberPlayer(url)
    var isPlaying by remember(player) { mutableStateOf(false) }
    var isReady by remember(player) { mutableStateOf(false) }
    var position by remember(player) { mutableLongStateOf(0L) }
    var duration by remember(player) { mutableLongStateOf(0L) }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY || state == Player.STATE_ENDED) isReady = true
                if (player.duration != C.TIME_UNSET) duration = player.duration
                position = player.currentPosition
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(player, isPlaying) {
        while (isPlaying) {
            position = player.currentPosition
            delay(250)
        }
        position = player.currentPosition
    }

    val totalSeconds = if (duration > 0) duration / 1000.0 else savedDuration ?: 0.0
    val progress = if (totalSeconds > 0) (position / 1000.0 / totalSeconds).coerceIn(0.0, 1.0).toFloat() else 0f
    val started = position > 0 || isPlaying
    val timeLabel = if (started) {
        "${CardSheet.formatDuration(position / 1000.0)} / ${CardSheet.formatDuration(totalSeconds)}"
    } else {
        CardSheet.formatDuration(totalSeconds)
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, MediaShape)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FilledTonalIconButton(
            onClick = {
                if (isPlaying) {
                    player.pause()
                } else {
                    if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                    player.play()
                }
            },
            enabled = isReady,
            modifier = Modifier.size(52.dp),
        ) {
            Icon(
                if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (isPlaying) "Pause" else "Play",
            )
        }
        Waveform(cardId, progress, Modifier.weight(1f).height(36.dp))
        Text(timeLabel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Waveform(seed: String, progress: Float, modifier: Modifier = Modifier) {
    val heights = remember(seed) { CardGrid.waveformHeights(seed) }
    val played = MaterialTheme.colorScheme.primary
    val unplayed = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)
    val playedBars = (progress * heights.size).roundToInt()
    Canvas(
        modifier.semantics {
            contentDescription = "Playback progress"
            progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f)
        },
    ) {
        val step = size.width / heights.size
        val barWidth = minOf(step * 0.6f, 3.dp.toPx())
        heights.forEachIndexed { index, value ->
            val barHeight = size.height * value
            drawRoundRect(
                color = if (index < playedBars) played else unplayed,
                topLeft = Offset(step * index + (step - barWidth) / 2, (size.height - barHeight) / 2),
                size = Size(barWidth, barHeight),
                cornerRadius = CornerRadius(barWidth / 2),
            )
        }
    }
}

/** Opens [url] in the full-screen viewer while set. */
@Composable
internal fun rememberImageViewer(contentDescription: String?): (String) -> Unit {
    var viewing by rememberSaveable { mutableStateOf<String?>(null) }
    viewing?.let { ImageViewer(it, contentDescription) { viewing = null } }
    return { viewing = it }
}
