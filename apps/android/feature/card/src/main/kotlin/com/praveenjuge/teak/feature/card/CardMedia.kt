package com.praveenjuge.teak.feature.card

import android.content.ActivityNotFoundException
import android.widget.Toast
import androidx.activity.compose.LocalActivity
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.toSize
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
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.CardGrid
import com.praveenjuge.teak.core.model.CardSheet
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import androidx.media3.ui.compose.material3.Player as MediaPlayer
import android.content.Context
import android.content.Intent
import androidx.media3.common.PlaybackException
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.core.net.toUri
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

internal val MAX_MEDIA_HEIGHT = 440.dp
private val PLACEHOLDER_HEIGHT = 200.dp
internal val MediaShape = RoundedCornerShape(20.dp)

internal fun mediaRatio(width: Double?, height: Double?): Float? =
    if (width != null && height != null && width > 0 && height > 0) (width / height).toFloat() else null

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
        Modifier.clickable(onClickLabel = tr("native.card.preview.viewFullScreen")) { onOpen(url) }
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

@Composable
internal fun ImageViewer(url: String, contentDescription: String?, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        var scale by remember { mutableFloatStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }
        var viewport by remember { mutableStateOf(Size.Zero) }
        var imageSize by remember { mutableStateOf(Size.Unspecified) }
        val transform = rememberTransformableState { zoom, pan, _ ->
            scale = (scale * zoom).coerceIn(1f, 5f)
            offset = if (scale == 1f) Offset.Zero else clampPan(offset + pan, scale, imageSize, viewport)
        }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AsyncImage(
                model = url,
                contentDescription = contentDescription,
                contentScale = ContentScale.Fit,
                onSuccess = { imageSize = it.painter.intrinsicSize },
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewport = it.toSize() }
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
                Icon(Icons.Filled.Close, contentDescription = tr("common.close"))
            }
        }
    }
}

/**
 * Keeps a zoomed image's edges at or past the screen's, so it can't be dragged off. [image] is its own size; it's
 * fitted into [viewport] and scaled around the center.
 */
private fun clampPan(offset: Offset, scale: Float, image: Size, viewport: Size): Offset {
    val fit = if (image.isSpecified && image.width > 0 && image.height > 0) {
        minOf(viewport.width / image.width, viewport.height / image.height)
    } else {
        null
    }
    val shown = fit?.let { Size(image.width * it, image.height * it) } ?: viewport
    val maxX = ((shown.width * scale - viewport.width) / 2).coerceAtLeast(0f)
    val maxY = ((shown.height * scale - viewport.height) / 2).coerceAtLeast(0f)
    return Offset(offset.x.coerceIn(-maxX, maxX), offset.y.coerceIn(-maxY, maxY))
}

/**
 * A player for [url]. It loads nothing until it's prepared: a video on its first play, a recording once it's shown.
 * Turning the screen picks up where it was, still playing if it was.
 */
@OptIn(UnstableApi::class)
@Composable
private fun rememberPlayer(url: String): ExoPlayer {
    val context = LocalContext.current
    val activity = LocalActivity.current
    var resumeAt by rememberSaveable(url) { mutableLongStateOf(0L) }
    var resumePlaying by rememberSaveable(url) { mutableStateOf(false) }
    val player = remember(url) {
        ExoPlayer.Builder(context, DefaultRenderersFactory(context).setEnableDecoderFallback(true)).build().apply {
            setMediaItem(MediaItem.fromUri(url), resumeAt)
            if (resumeAt > 0 || resumePlaying) {
                playWhenReady = resumePlaying
                prepare()
            }
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    // Stopping comes before the state is saved, so this is what a rotation restores.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        resumeAt = player.currentPosition
        resumePlaying = player.playWhenReady && activity?.isChangingConfigurations == true
        player.pause()
    }
    return player
}

@OptIn(UnstableApi::class)
@Composable
internal fun VideoPlayer(url: String, posterUrl: String?, ratio: Float?, modifier: Modifier = Modifier) {
    // Its play button prepares it, so opening a card doesn't start buffering the video.
    val player = rememberPlayer(url)
    var failed by remember(player) { mutableStateOf(false) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    MediaFrame(ratio ?: (16f / 9f), modifier) { frame ->
        if (failed) {
            UnplayableVideo(url, posterUrl, frame)
        } else {
            MediaPlayer(
                player = player,
                modifier = frame.background(Color.Black),
                shutter = { Poster(posterUrl) },
            )
        }
    }
}

@Composable
private fun Poster(posterUrl: String?) {
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
}

@Composable
private fun UnplayableVideo(url: String, posterUrl: String?, modifier: Modifier) {
    val context = LocalContext.current
    Box(modifier, contentAlignment = Alignment.Center) {
        Poster(posterUrl)
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.94f),
            modifier = Modifier.padding(16.dp),
        ) {
            Column(
                Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(tr("android.card.videoUnplayable"), style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = { context.openMediaElsewhere(url, "video/*") }) { Text(tr("android.card.openInAnotherApp")) }
            }
        }
    }
}

private fun Context.openMediaElsewhere(url: String, type: String) {
    try {
        // A kept file is a content link to the app's FileProvider, which the other app may read.
        startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(url.toUri(), type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(this, resources.tr("android.card.noAppForLink"), Toast.LENGTH_SHORT).show()
    }
}

/** The audio player's place when the recording won't load, as the video player does. */
@Composable
private fun UnplayableAudio(url: String, modifier: Modifier) {
    val context = LocalContext.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, MediaShape)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(tr("native.card.preview.audioUnavailable"), style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { context.openMediaElsewhere(url, "audio/*") }) { Text(tr("android.card.openInAnotherApp")) }
    }
}

@Composable
internal fun AudioPlayer(cardId: String, url: String?, savedDuration: Double?, modifier: Modifier = Modifier) {
    if (url == null) {
        MediaPlaceholder(Icons.Outlined.GraphicEq, tr("native.card.preview.audioUnavailable"), modifier)
        return
    }
    val player = rememberPlayer(url)
    var isPlaying by remember(player) { mutableStateOf(false) }
    var isReady by remember(player) { mutableStateOf(false) }
    var position by remember(player) { mutableLongStateOf(0L) }
    var duration by remember(player) { mutableLongStateOf(0L) }
    var failed by remember(player) { mutableStateOf(false) }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlayerError(error: PlaybackException) {
                failed = true
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY || state == Player.STATE_ENDED) isReady = true
                if (player.duration != C.TIME_UNSET) duration = player.duration
                position = player.currentPosition
            }
        }
        player.addListener(listener)
        // Loaded once it's shown, so its length is known and Play is ready.
        player.prepare()
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
    // Where a drag on the waveform is, until it lets go and seeks there.
    var scrub by remember(player) { mutableStateOf<Float?>(null) }
    val playedProgress = if (totalSeconds > 0) (position / 1000.0 / totalSeconds).coerceIn(0.0, 1.0).toFloat() else 0f
    val progress = scrub ?: playedProgress
    val shownSeconds = scrub?.let { it * totalSeconds } ?: (position / 1000.0)
    val started = position > 0 || isPlaying || scrub != null
    val timeLabel = if (started) {
        "${CardSheet.formatDuration(shownSeconds)} / ${CardSheet.formatDuration(totalSeconds)}"
    } else {
        CardSheet.formatDuration(totalSeconds)
    }
    fun seek(fraction: Float) {
        val target = (fraction.coerceIn(0f, 1f) * totalSeconds * 1000).toLong()
        player.seekTo(target)
        position = target
    }
    if (failed) {
        UnplayableAudio(url, modifier)
        return
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
                contentDescription = if (isPlaying) tr("native.card.preview.pause") else tr("native.card.preview.play"),
            )
        }
        SeekableWaveform(
            seed = cardId,
            progress = progress,
            positionText = tr(
                "native.media.seekPosition",
                CardSheet.formatDuration(shownSeconds),
                CardSheet.formatDuration(totalSeconds),
            ),
            enabled = totalSeconds > 0,
            onScrub = { scrub = it },
            onSeek = { fraction ->
                scrub = null
                seek(fraction)
            },
            modifier = Modifier.weight(1f).height(44.dp),
        )
        Text(timeLabel, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The waveform as a seek bar, like the web's: tap or drag to move through the recording. [onScrub] follows a
 * drag (null when it's cancelled), and [onSeek] gets where it ended. TalkBack reads it as an adjustable bar.
 */
@Composable
private fun SeekableWaveform(
    seed: String,
    progress: Float,
    positionText: String,
    enabled: Boolean,
    onScrub: (Float?) -> Unit,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val heights = remember(seed) { CardGrid.waveformHeights(seed) }
    val played = MaterialTheme.colorScheme.primary
    val unplayed = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)
    val playedBars = (progress * heights.size).roundToInt()
    val label = tr("native.media.seek")
    var width by remember { mutableFloatStateOf(1f) }
    // The gesture handlers outlive a recomposition, so they read the latest callbacks, which know the duration.
    val scrubTo by rememberUpdatedState(onScrub)
    val seekTo by rememberUpdatedState(onSeek)
    fun fraction(x: Float) = (x / width).coerceIn(0f, 1f)
    val gestures = if (enabled) {
        Modifier
            .pointerInput(Unit) { detectTapGestures { seekTo(fraction(it.x)) } }
            .pointerInput(Unit) {
                var last = 0f
                detectHorizontalDragGestures(
                    onDragStart = {
                        last = fraction(it.x)
                        scrubTo(last)
                    },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        last = fraction(change.position.x)
                        scrubTo(last)
                    },
                    onDragEnd = { seekTo(last) },
                    onDragCancel = { scrubTo(null) },
                )
            }
    } else {
        Modifier
    }
    Canvas(
        modifier
            .onSizeChanged { width = it.width.toFloat().coerceAtLeast(1f) }
            .then(gestures)
            .semantics {
                contentDescription = label
                stateDescription = positionText
                progressBarRangeInfo = ProgressBarRangeInfo(progress, 0f..1f)
                if (enabled) {
                    setProgress { target ->
                        onSeek(target)
                        true
                    }
                } else {
                    disabled()
                }
            },
    ) {
        val step = size.width / heights.size
        val barWidth = minOf(step * 0.6f, 3.dp.toPx())
        heights.forEachIndexed { index, value ->
            val barHeight = size.height * 0.82f * value
            drawRoundRect(
                color = if (index < playedBars) played else unplayed,
                topLeft = Offset(step * index + (step - barWidth) / 2, (size.height - barHeight) / 2),
                size = Size(barWidth, barHeight),
                cornerRadius = CornerRadius(barWidth / 2),
            )
        }
    }
}

@Composable
internal fun rememberImageViewer(contentDescription: String?): (String) -> Unit {
    var viewing by rememberSaveable { mutableStateOf<String?>(null) }
    viewing?.let { ImageViewer(it, contentDescription) { viewing = null } }
    return { viewing = it }
}
