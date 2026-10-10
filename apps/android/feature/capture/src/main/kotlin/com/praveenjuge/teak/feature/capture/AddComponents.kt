package com.praveenjuge.teak.feature.capture

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.contentColorFor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.upload.UploadStatus

@Composable
internal fun SectionHeader(title: String, trailing: (@Composable () -> Unit)? = null) {
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

/** Rows grouped on one rounded surface, like an inset list. */
@Composable
internal fun ActionGroup(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Column(content = content)
    }
}

@Composable
internal fun ActionRow(
    label: String,
    icon: ImageVector,
    iconContainer: Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    ListItem(
        modifier = Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = {
            Surface(shape = CircleShape, color = iconContainer, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = contentColorFor(iconContainer))
                }
            }
        },
        headlineContent = {
            Text(
                label,
                color = if (enabled) Color.Unspecified else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
            )
        },
    )
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun UploadRow(upload: UploadStatus) {
    val limitReached = upload.errorCode == TeakException.CARD_LIMIT_REACHED
    ListItem(
        modifier = Modifier.padding(horizontal = 16.dp),
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        headlineContent = { Text(upload.fileName, maxLines = 1, overflow = TextOverflow.MiddleEllipsis) },
        supportingContent = {
            when (upload.state) {
                UploadStatus.State.Waiting -> Text("Waiting to upload")
                UploadStatus.State.Uploading -> LinearWavyProgressIndicator(
                    progress = { upload.progress },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                UploadStatus.State.Saved -> Text("Saved")
                UploadStatus.State.Failed -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        if (limitReached) "Card limit reached" else "Failed",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Text(upload.error ?: "The upload didn't finish. Please try again.")
                    if (limitReached) Text("The Free plan holds 200 cards.")
                }
            }
        },
        trailingContent = {
            when (upload.state) {
                UploadStatus.State.Saved -> Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = "Saved",
                    tint = MaterialTheme.colorScheme.primary,
                )
                UploadStatus.State.Failed -> Icon(
                    Icons.Filled.Error,
                    contentDescription = "Failed",
                    tint = MaterialTheme.colorScheme.error,
                )
                else -> Unit
            }
        },
    )
}
