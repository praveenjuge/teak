package com.praveenjuge.teak.feature.capture

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.data.upload.UploadStatus

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
