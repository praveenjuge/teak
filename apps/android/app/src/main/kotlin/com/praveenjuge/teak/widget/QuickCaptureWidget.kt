package com.praveenjuge.teak.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import com.praveenjuge.teak.MainActivity
import com.praveenjuge.teak.R
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.tr

/**
 * One tap to start saving: a note, a voice memo, photos, the camera or files, as Apple's Quick Capture widget.
 * Each tile is only its icon; its label is what TalkBack reads. It shows no cards, so it reads nothing.
 */
class QuickCaptureWidget : GlanceAppWidget() {
    // The note tile is square, so it needs the widget's real height.
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val resources = AppLanguage.resources(context)
        val labels = CaptureAction.entries.associateWith { resources.tr(it.label) }
        provideContent { GlanceTheme { QuickCaptureContent(labels) } }
    }
}

class QuickCaptureWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = QuickCaptureWidget()
}

internal enum class CaptureAction(val action: String, val label: String, val icon: Int) {
    Note(MainActivity.ACTION_NEW_NOTE, "native.capture.newNote", R.drawable.ic_widget_note),
    Voice(MainActivity.ACTION_VOICE_MEMO, "native.capture.voiceMemo", R.drawable.ic_widget_mic),
    Photos(MainActivity.ACTION_PHOTOS, "native.capture.photosAndVideos", R.drawable.ic_widget_photos),
    Camera(MainActivity.ACTION_CAMERA, "native.capture.camera", R.drawable.ic_widget_camera),
    Files(MainActivity.ACTION_FILES, "native.capture.files", R.drawable.ic_widget_files),
}

@Composable
private fun QuickCaptureContent(labels: Map<CaptureAction, String>) {
    val size = LocalSize.current
    Box(GlanceModifier.widgetSurface().padding(WidgetTiles.inset)) {
        if (size.width >= WidgetTiles.wide) {
            // A large New Note beside the rest, two by two.
            Row(GlanceModifier.fillMaxSize()) {
                val side = size.height - WidgetTiles.inset * 2
                CaptureTile(CaptureAction.Note, labels, GlanceModifier.width(side).fillMaxHeight(), large = true)
                Spacer(GlanceModifier.width(WidgetTiles.gap))
                val rest = listOf(CaptureAction.Voice, CaptureAction.Photos, CaptureAction.Camera, CaptureAction.Files)
                TileGrid(2, 2, GlanceModifier.defaultWeight().fillMaxHeight()) { index, modifier ->
                    CaptureTile(rest[index], labels, modifier)
                }
            }
        } else {
            // The four most used, two by two.
            val four = listOf(CaptureAction.Note, CaptureAction.Voice, CaptureAction.Photos, CaptureAction.Files)
            TileGrid(2, 2, GlanceModifier.fillMaxSize()) { index, modifier ->
                CaptureTile(four[index], labels, modifier)
            }
        }
    }
}

@Composable
private fun CaptureTile(action: CaptureAction, labels: Map<CaptureAction, String>, modifier: GlanceModifier, large: Boolean = false) {
    val context = LocalContext.current
    Box(
        modifier
            .tileCorner()
            .background(GlanceTheme.colors.secondaryContainer)
            .clickable(actionStartActivity(Intent(context, MainActivity::class.java).setAction(action.action))),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            provider = ImageProvider(action.icon),
            contentDescription = labels[action],
            modifier = GlanceModifier.size(if (large) 36.dp else 24.dp),
            colorFilter = ColorFilter.tint(GlanceTheme.colors.onSecondaryContainer),
        )
    }
}
