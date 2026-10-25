package com.praveenjuge.teak.feature.settings

import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.ListGroup
import com.praveenjuge.teak.core.designsystem.component.ListRow
import com.praveenjuge.teak.core.designsystem.component.ListRowValue
import com.praveenjuge.teak.core.designsystem.component.ListSectionHeader
import com.praveenjuge.teak.core.designsystem.component.TypedConfirmDialog
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth

@Composable
fun SettingsRoute(onManageTags: () -> Unit = {}, viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    SettingsScreen(
        state = state,
        versionName = viewModel.versionName,
        onThemeChange = viewModel::setTheme,
        onLanguageChange = viewModel::chooseLanguage,
        onUndoLanguage = viewModel::undoLanguage,
        onDismissLanguageNotice = viewModel::dismissLanguageNotice,
        onSignOut = viewModel::requestSignOut,
        onConfirmSignOut = viewModel::signOut,
        onCancelSignOut = viewModel::cancelSignOut,
        onDelete = viewModel::requestDelete,
        onContinueDelete = viewModel::continueDelete,
        onConfirmDelete = viewModel::confirmDelete,
        onCancelDelete = viewModel::cancelDelete,
        onDismissError = viewModel::dismissError,
        onOpenLink = { url -> CustomTabsIntent.Builder().build().launchUrl(context, url.toUri()) },
        onManageTags = onManageTags,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: SettingsUiState,
    versionName: String,
    onThemeChange: (ThemePreference) -> Unit,
    onLanguageChange: (String) -> Unit,
    onUndoLanguage: () -> Unit,
    onDismissLanguageNotice: () -> Unit,
    onSignOut: () -> Unit,
    onConfirmSignOut: () -> Unit,
    onCancelSignOut: () -> Unit,
    onDelete: () -> Unit,
    onContinueDelete: () -> Unit,
    onConfirmDelete: (String) -> Unit,
    onCancelDelete: () -> Unit,
    onDismissError: () -> Unit,
    onOpenLink: (String) -> Unit,
    onManageTags: () -> Unit = {},
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior(rememberTopAppBarState())
    val snackbar = remember { SnackbarHostState() }
    LanguageNoticeEffect(state.languageNotice, snackbar, onUndoLanguage, onDismissLanguageNotice)
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text(tr("native.settings.title")) }, scrollBehavior = scrollBehavior) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxWidth()
                .wrapContentWidth()
                .widthIn(max = 720.dp)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            ListSectionHeader(tr("native.settings.appearance"))
            ThemePicker(state.theme, onThemeChange)
            Spacer(Modifier.height(12.dp))
            LanguageSetting(state.language, enabled = !state.isChangingLanguage, onChoose = onLanguageChange)

            ListSectionHeader(tr("native.settings.library"))
            ListGroup {
                ListRow(tr("native.tags.title"), Icons.Outlined.Sell, supporting = tr("native.settings.tagsDescription"), onClick = onManageTags)
            }

            ListSectionHeader(tr("native.settings.account"))
            ListGroup {
                ListRow(tr("native.settings.email"), Icons.Outlined.Mail, supporting = state.email ?: tr("native.settings.notSignedIn"))
                ListRow(tr("native.settings.usage"), Icons.Outlined.Inventory2, trailing = { LoadingValue(state.usage?.resolve()) })
                ListRow(
                    tr("native.settings.plan"),
                    Icons.Outlined.WorkspacePremium,
                    trailing = { LoadingValue(state.plan?.takeIf { state.usage != null }?.resolve()) },
                )
            }
            Spacer(Modifier.height(12.dp))
            ListGroup {
                ListRow(
                    label = if (state.isSigningOut) tr("native.settings.signingOut") else tr("native.settings.signOut"),
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    enabled = !state.isSigningOut,
                    onClick = onSignOut,
                )
                ListRow(
                    label = if (state.isDeleting) tr("native.settings.deleting") else tr("native.settings.deleteAccount"),
                    icon = Icons.Outlined.DeleteForever,
                    enabled = !state.isDeleting,
                    destructive = true,
                    onClick = onDelete,
                )
            }

            ListSectionHeader(tr("native.settings.about"))
            ListGroup {
                ListRow(
                    // The app's name and the author's handle stay as they are in every language.
                    label = "Teak",
                    icon = Icons.Outlined.Info,
                    supporting = "by @praveenjuge. ${tr("native.settings.hope")}",
                    trailing = { ListRowValue(versionName) },
                )
                ListRow(tr("native.settings.helpDocs"), Icons.Outlined.Description, onClick = { onOpenLink("https://teakvault.com/docs") })
                ListRow(
                    tr("native.settings.privacyPolicy"),
                    Icons.Outlined.Policy,
                    onClick = { onOpenLink("https://teakvault.com/docs/privacy-policy") },
                )
            }
        }
    }

    if (state.confirmSignOut) {
        ConfirmDialog(
            title = tr("native.settings.signOut"),
            message = tr("native.settings.signOutConfirm"),
            confirmLabel = tr("native.settings.signOut"),
            onConfirm = onConfirmSignOut,
            onDismiss = onCancelSignOut,
        )
    }
    when (state.deleteStep) {
        DeleteStep.Warning -> ConfirmDialog(
            title = tr("native.settings.deleteAccount"),
            message = tr("native.settings.deleteWarning"),
            confirmLabel = tr("native.settings.deleteAccount"),
            onConfirm = onContinueDelete,
            onDismiss = onCancelDelete,
        )
        DeleteStep.Confirm -> TypedConfirmDialog(
            title = tr("native.settings.deleteAccount"),
            message = tr("native.settings.typeToConfirm", SettingsViewModel.DELETE_PHRASE),
            phrase = SettingsViewModel.DELETE_PHRASE,
            confirmLabel = tr("native.actions.deleteForever"),
            onConfirm = { onConfirmDelete(SettingsViewModel.DELETE_PHRASE) },
            onDismiss = onCancelDelete,
        )
        DeleteStep.None -> Unit
    }
    state.error?.let { message ->
        AlertDialog(
            onDismissRequest = onDismissError,
            title = { Text(tr("native.settings.deleteAccount")) },
            text = { Text(message.resolve()) },
            confirmButton = { TextButton(onClick = onDismissError) { Text(tr("native.capture.ok")) } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThemePicker(selected: ThemePreference, onChange: (ThemePreference) -> Unit) {
    val options = listOf(
        ThemePreference.System to tr("native.settings.themeAuto"),
        ThemePreference.Light to tr("native.settings.themeLight"),
        ThemePreference.Dark to tr("native.settings.themeDark"),
    )
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        options.forEachIndexed { index, (value, label) ->
            SegmentedButton(
                selected = selected == value,
                onClick = { onChange(value) },
                shape = SegmentedButtonDefaults.itemShape(index, options.size),
            ) { Text(label) }
        }
    }
}

@Composable
private fun LoadingValue(value: String?) {
    if (value == null) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
    } else {
        ListRowValue(value)
    }
}
