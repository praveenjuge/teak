package com.praveenjuge.teak.core.designsystem.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** A small title above a group of rows, with an optional action on the right. */
@Composable
fun ListSectionHeader(title: String, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 32.dp, end = 20.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.semantics { heading() },
        )
        trailing?.invoke()
    }
}

/** Rows grouped on one rounded surface, like an inset list in the system Settings app. */
@Composable
fun ListGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column(content = content)
    }
}

/**
 * One row: a tonal icon circle, a label, and optional supporting and trailing text. Rows without
 * [onClick] are read-only. [destructive] marks actions that delete things.
 */
@Composable
fun ListRow(
    label: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    trailing: (@Composable () -> Unit)? = null,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    val disabled = colors.onSurface.copy(alpha = 0.38f)
    ListItem(
        modifier = if (onClick != null) {
            modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        } else {
            modifier
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = {
            Surface(
                shape = CircleShape,
                color = if (destructive) colors.errorContainer else colors.secondaryContainer,
                contentColor = if (destructive) colors.onErrorContainer else colors.onSecondaryContainer,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = if (enabled) LocalContentColor.current else disabled)
                }
            }
        },
        headlineContent = {
            Text(
                label,
                color = when {
                    !enabled -> disabled
                    destructive -> colors.error
                    else -> Color.Unspecified
                },
            )
        },
        supportingContent = supporting?.let { { Text(it, color = colors.onSurfaceVariant) } },
        trailingContent = trailing,
    )
}

/** Read-only trailing text for a [ListRow], such as a count or a plan name. */
@Composable
fun ListRowValue(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
