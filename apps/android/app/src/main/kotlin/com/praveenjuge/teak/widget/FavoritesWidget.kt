package com.praveenjuge.teak.widget

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.compose.runtime.collectAsState
import com.praveenjuge.teak.MainActivity
import com.praveenjuge.teak.R
import com.praveenjuge.teak.core.i18n.AppLanguage
import com.praveenjuge.teak.core.i18n.text
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.FavoritesSnapshot
import com.praveenjuge.teak.core.model.parseHexArgb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The newest favorites, from the snapshot [FavoritesWidgetWriter] keeps, as Apple's Favorites widget: one card
 * edge to edge when small, a 2×2 grid when wide and 2×3 when tall too. Each card shows as itself, with no
 * caption; tapping one opens it in Teak.
 */
class FavoritesWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val first = load(context)
        provideContent {
            // A widget already on screen reloads when the snapshot changes, without waiting for its session to end.
            val favorites by remember { changes.drop(1).map { load(context) } }.collectAsState(first)
            GlanceTheme { FavoritesContent(favorites) }
        }
    }

    companion object {
        private val changes = MutableStateFlow(0)

        /** Redraws every Favorites widget from the snapshot as it is now. */
        suspend fun redraw(context: Context) {
            changes.value++
            FavoritesWidget().updateAll(context)
        }

        private suspend fun load(context: Context): Favorites = withContext(Dispatchers.IO) {
            val resources = AppLanguage.resources(context)
            val folder = FavoritesSnapshot.folder(context.filesDir)
            val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 }
            val tiles = FavoritesSnapshot.read(folder).cards.map { card ->
                FavoriteTile(
                    id = card.id,
                    words = card.title.ifBlank { resources.text(card.type.labelText) },
                    colors = card.colors.mapNotNull { parseHexArgb(it)?.let(::Color) },
                    image = card.image?.let { BitmapFactory.decodeFile(File(folder, it).path, options) },
                )
            }
            Favorites(tiles, resources.tr("native.widgets.favoritesEmpty"))
        }
    }
}

class FavoritesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = FavoritesWidget()
}

private data class Favorites(val tiles: List<FavoriteTile>, val emptyText: String)

private class FavoriteTile(val id: String, val words: String, val colors: List<Color>, val image: Bitmap?)

@Composable
private fun FavoritesContent(favorites: Favorites) {
    val size = LocalSize.current
    val first = favorites.tiles.firstOrNull()
    when {
        first == null -> Empty(favorites.emptyText)
        // One favorite, edge to edge.
        size.width < WidgetTiles.wide ->
            Box(GlanceModifier.widgetSurface().clickable(openCard(first.id))) {
                Tile(first, fillsWidget = true, lines = linesThatFit(size.height - WIDGET_PADDING * 2, WIDGET_LINE))
            }
        else -> {
            val rows = if (size.height >= WidgetTiles.tall) 3 else 2
            val tileHeight = (size.height - WidgetTiles.inset * 2 - WidgetTiles.gap * (rows - 1)) / rows
            Box(GlanceModifier.widgetSurface().padding(WidgetTiles.inset)) {
                TileGrid(rows, 2, GlanceModifier.fillMaxSize()) { index, modifier ->
                    val tile = favorites.tiles.getOrNull(index)
                    if (tile == null) {
                        Box(modifier.tileCorner().background(GlanceTheme.colors.surfaceVariant)) {}
                    } else {
                        Box(modifier.tileCorner().background(GlanceTheme.colors.secondaryContainer).clickable(openCard(tile.id))) {
                            Tile(tile, fillsWidget = false, lines = linesThatFit(tileHeight - TILE_PADDING * 2, TILE_LINE))
                        }
                    }
                }
            }
        }
    }
}

private val TILE_PADDING = 10.dp
private val TILE_LINE = 18.dp
private val WIDGET_PADDING = 16.dp
private val WIDGET_LINE = 22.dp

/** Whole lines only, so a tile's words never end in a clipped half line. */
private fun linesThatFit(height: Dp, line: Dp): Int = (height / line).toInt().coerceIn(1, 8)

/** A card as itself: its picture, its palette as bands, or its words on a quiet tile. */
@Composable
private fun Tile(tile: FavoriteTile, fillsWidget: Boolean, lines: Int) {
    when {
        tile.image != null -> Image(
            provider = ImageProvider(tile.image),
            contentDescription = tile.words,
            modifier = GlanceModifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
        )
        tile.colors.isNotEmpty() -> Row(GlanceModifier.fillMaxSize()) {
            for (color in tile.colors) Box(GlanceModifier.defaultWeight().fillMaxHeight().background(color)) {}
        }
        else -> Box(
            GlanceModifier.fillMaxSize()
                .background(if (fillsWidget) GlanceTheme.colors.widgetBackground else GlanceTheme.colors.secondaryContainer)
                .padding(if (fillsWidget) WIDGET_PADDING else TILE_PADDING),
            contentAlignment = Alignment.TopStart,
        ) {
            Text(
                text = tile.words,
                maxLines = lines,
                style = TextStyle(
                    color = GlanceTheme.colors.onSecondaryContainer,
                    fontSize = if (fillsWidget) 16.sp else 13.sp,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }
    }
}

@Composable
private fun Empty(text: String) {
    val context = LocalContext.current
    Column(
        GlanceModifier.widgetSurface().padding(WidgetTiles.inset)
            .clickable(actionStartActivity(Intent(context, MainActivity::class.java))),
        verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            provider = ImageProvider(R.drawable.ic_widget_favorite),
            contentDescription = null,
            modifier = GlanceModifier.size(28.dp),
            colorFilter = ColorFilter.tint(GlanceTheme.colors.onSurfaceVariant),
        )
        Spacer(GlanceModifier.height(8.dp))
        Text(
            text = text,
            style = TextStyle(
                color = GlanceTheme.colors.onSurfaceVariant,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

@Composable
private fun openCard(id: String) = actionStartActivity(
    Intent(LocalContext.current, MainActivity::class.java)
        .setAction(MainActivity.ACTION_OPEN_CARD)
        .putExtra(MainActivity.EXTRA_CARD_ID, id),
)
