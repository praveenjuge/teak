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
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
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
import androidx.compose.runtime.getValue

@Composable
fun SettingsRoute(viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    SettingsScreen(
        state = state,
        versionName = viewModel.versionName,
        onThemeChange = viewModel::setTheme,
        onSignOut = viewModel::requestSignOut,
        onConfirmSignOut = viewModel::signOut,
        onCancelSignOut = viewModel::cancelSignOut,
        onDelete = viewModel::requestDelete,
        onContinueDelete = viewModel::continueDelete,
        onConfirmDelete = viewModel::confirmDelete,
        onCancelDelete = viewModel::cancelDelete,
        onDismissError = viewModel::dismissError,
        onOpenLink = { url -> CustomTabsIntent.Builder().build().launchUrl(context, url.toUri()) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: SettingsUiState,
    versionName: String,
    onThemeChange: (ThemePreference) -> Unit,
    onSignOut: () -> Unit,
    onConfirmSignOut: () -> Unit,
    onCancelSignOut: () -> Unit,
    onDelete: () -> Unit,
    onContinueDelete: () -> Unit,
    onConfirmDelete: (String) -> Unit,
    onCancelDelete: () -> Unit,
    onDismissError: () -> Unit,
    onOpenLink: (String) -> Unit,
) {
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior(rememberTopAppBarState())
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { LargeTopAppBar(title = { Text("Settings") }, scrollBehavior = scrollBehavior) },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            ListSectionHeader("Appearance")
            ThemePicker(state.theme, onThemeChange)

            ListSectionHeader("Account")
            ListGroup {
                // An email can be long, so it goes under its label instead of squeezing it.
                ListRow("Email", Icons.Outlined.Mail, supporting = state.email ?: "Not logged in")
                ListRow("Usage", Icons.Outlined.Inventory2, trailing = { LoadingValue(state.usage) })
                ListRow("Plan", Icons.Outlined.WorkspacePremium, trailing = { LoadingValue(state.plan.takeIf { state.usage != null }) })
            }
            Spacer(Modifier.height(12.dp))
            ListGroup {
                ListRow(
                    label = if (state.isSigningOut) "Logging Out…" else "Log Out",
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    enabled = !state.isSigningOut,
                    onClick = onSignOut,
                )
                ListRow(
                    label = if (state.isDeleting) "Deleting…" else "Delete Account",
                    icon = Icons.Outlined.DeleteForever,
                    enabled = !state.isDeleting && !state.accountChangesPaused,
                    destructive = true,
                    onClick = onDelete,
                )
            }

            ListSectionHeader("About")
            ListGroup {
                ListRow(
                    label = "Teak",
                    icon = Icons.Outlined.Info,
                    supporting = "by @praveenjuge. Hope you enjoy using Teak as much as I enjoyed creating it.",
                    trailing = { ListRowValue(versionName) },
                )
                ListRow("Help & Docs", Icons.Outlined.Description, onClick = { onOpenLink("https://teakvault.com/docs") })
                ListRow("Privacy Policy", Icons.Outlined.Policy, onClick = { onOpenLink("https://teakvault.com/docs/privacy-policy") })
            }
        }
    }

    if (state.confirmSignOut) {
        ConfirmDialog(
            title = "Log Out",
            message = "Are you sure you want to log out?",
            confirmLabel = "Log Out",
            onConfirm = onConfirmSignOut,
            onDismiss = onCancelSignOut,
        )
    }
    when (state.deleteStep) {
        DeleteStep.Warning -> ConfirmDialog(
            title = "Delete Account",
            message = "This will permanently remove your account, cards, tags, and uploaded files. Are you sure?",
            confirmLabel = "Delete Account",
            onConfirm = onContinueDelete,
            onDismiss = onCancelDelete,
        )
        DeleteStep.Confirm -> TypedConfirmDialog(
            title = "Delete Account",
            message = "Type \"${SettingsViewModel.DELETE_PHRASE}\" to confirm. This can't be undone.",
            phrase = SettingsViewModel.DELETE_PHRASE,
            confirmLabel = "Delete Forever",
            onConfirm = { onConfirmDelete(SettingsViewModel.DELETE_PHRASE) },
            onDismiss = onCancelDelete,
        )
        DeleteStep.None -> Unit
    }
    state.error?.let { message ->
        AlertDialog(
            onDismissRequest = onDismissError,
            title = { Text("Delete Account") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = onDismissError) { Text("OK") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThemePicker(selected: ThemePreference, onChange: (ThemePreference) -> Unit) {
    val options = listOf(ThemePreference.System to "Auto", ThemePreference.Light to "Light", ThemePreference.Dark to "Dark")
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

/** A row's value, or a small spinner while it loads. */
@Composable
private fun LoadingValue(value: String?) {
    if (value == null) {
        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
    } else {
        ListRowValue(value)
    }
}
