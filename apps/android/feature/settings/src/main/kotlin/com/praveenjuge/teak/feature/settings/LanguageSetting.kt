package com.praveenjuge.teak.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
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
import com.praveenjuge.teak.core.designsystem.component.ListRow
import com.praveenjuge.teak.core.i18n.tr
import com.praveenjuge.teak.core.model.LOCALE_NAMES

/** Settings → Language. Each language is listed in its own name. */
@Composable
internal fun LanguageSetting(language: String, enabled: Boolean, onChoose: (String) -> Unit) {
    var picking by remember { mutableStateOf(false) }
    ListRow(
        label = tr("settings.language.label"),
        icon = Icons.Outlined.Language,
        supporting = LOCALE_NAMES[language] ?: language,
        enabled = enabled,
        onClick = { picking = true },
    )
    if (picking) {
        ChoiceDialog(
            title = tr("settings.language.label"),
            options = LOCALE_NAMES.toList(),
            selected = language,
            onChoose = {
                picking = false
                onChoose(it)
            },
            onDismiss = { picking = false },
        )
    }
}

/** A dialog of radio buttons, like Android's own list settings; choosing one closes it. */
@Composable
internal fun <T> ChoiceDialog(
    title: String,
    options: List<Pair<T, String>>,
    selected: T,
    onChoose: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.selectableGroup().verticalScroll(rememberScrollState())) {
                options.forEach { (value, name) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .selectable(selected = value == selected, role = Role.RadioButton, onClick = { onChoose(value) }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = value == selected, onClick = null)
                        Text(name, Modifier.padding(start = 12.dp))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(tr("common.cancel")) } },
    )
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
