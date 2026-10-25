package com.praveenjuge.teak.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.praveenjuge.teak.core.designsystem.component.ListGroup
import com.praveenjuge.teak.core.designsystem.component.ListRow
import com.praveenjuge.teak.core.designsystem.component.ListRowValue
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.LOCALE_NAMES

/** Settings → Language. Each language is listed in its own name. */
@Composable
internal fun LanguageSetting(language: String, enabled: Boolean, onChoose: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    ListGroup {
        ListRow(
            label = tr("settings.language.label"),
            icon = Icons.Outlined.Language,
            supporting = tr("native.settings.languageDescription"),
            trailing = { ListRowValue(LOCALE_NAMES[language] ?: language) },
            enabled = enabled,
            onClick = { picking = true },
        )
    }
    if (picking) {
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(tr("settings.language.label")) },
            text = {
                Column(Modifier.selectableGroup()) {
                    LOCALE_NAMES.forEach { (code, name) ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .selectable(
                                    selected = code == language,
                                    role = Role.RadioButton,
                                    onClick = {
                                        picking = false
                                        onChoose(code)
                                    },
                                )
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = code == language, onClick = null)
                            Text(name, Modifier.padding(start = 12.dp))
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { picking = false }) { Text(tr("common.cancel")) } },
        )
    }
}

/** "Language changed" with Undo, or why it couldn't change. */
@Composable
internal fun LanguageNoticeEffect(
    notice: LanguageNotice?,
    snackbar: SnackbarHostState,
    onUndo: () -> Unit,
    onDismiss: () -> Unit,
) {
    val changed = tr("settings.language.changed")
    val failed = tr("settings.language.changeFailed")
    val undo = tr("common.undo")
    LaunchedEffect(notice) {
        when (notice) {
            is LanguageNotice.Changed -> {
                val result = snackbar.showSnackbar(changed, actionLabel = undo, duration = SnackbarDuration.Long)
                if (result == SnackbarResult.ActionPerformed) onUndo() else onDismiss()
            }
            LanguageNotice.Failed -> {
                snackbar.showSnackbar(failed)
                onDismiss()
            }
            null -> Unit
        }
    }
}
