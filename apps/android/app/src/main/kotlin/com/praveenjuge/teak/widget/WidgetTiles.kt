package com.praveenjuge.teak.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width

/** The inset, spacing and breakpoints every Teak widget's tiles share, as Apple's `WidgetTiles`. */
internal object WidgetTiles {
    val inset = 12.dp
    val gap = 8.dp
    /** From this width a widget lays out as Apple's medium one: about three cells. */
    val wide = 240.dp
    /** From this height a wide widget has room for a third row: about three cells. */
    val tall = 240.dp
}

/** The widget's own surface, with the launcher's corner. */
@Composable
internal fun GlanceModifier.widgetSurface(): GlanceModifier =
    fillMaxSize()
        .appWidgetBackground()
        .background(GlanceTheme.colors.widgetBackground)
        .cornerRadius(android.R.dimen.system_app_widget_background_radius)

/** A tile's corner, which follows the widget's. */
internal fun GlanceModifier.tileCorner(): GlanceModifier = cornerRadius(android.R.dimen.system_app_widget_inner_radius)

/** Equal cells, [rows] by [columns], spaced alike. */
@Composable
internal fun TileGrid(
    rows: Int,
    columns: Int,
    modifier: GlanceModifier,
    cell: @Composable (index: Int, modifier: GlanceModifier) -> Unit,
) {
    Column(modifier) {
        for (row in 0 until rows) {
            if (row > 0) Spacer(GlanceModifier.height(WidgetTiles.gap))
            Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                for (column in 0 until columns) {
                    if (column > 0) Spacer(GlanceModifier.width(WidgetTiles.gap))
                    cell(row * columns + column, GlanceModifier.defaultWeight().fillMaxHeight())
                }
            }
        }
    }
}
