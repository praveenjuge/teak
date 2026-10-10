package com.praveenjuge.teak.feature.settings

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.prefs.ThemePreference
import com.praveenjuge.teak.core.designsystem.component.ConfirmDialog
import com.praveenjuge.teak.core.designsystem.component.TypedConfirmDialog

@Composable
fun SettingsRoute(viewModel: SettingsViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    SettingsScreen(
        state = state,
        versionName = remember(context) { context.versionName() },
        onThemeChange = viewModel::setTheme,
        onSignOut = viewModel::requestSignOut,
        onConfirmSignOut = viewModel::signOut,
        onCancelSignOut = viewModel::cancelSignOut,
        onDelete = viewModel::requestDelete,
        onContinueDelete = viewModel::continueDelete,
        onConfirmDelete = viewModel::confirmDelete,
        onCancelDelete = viewModel::cancelDelete,
        onDismissError = viewModel::dismissError,
        onOpenLink = { url -> CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) },
    )
}

private fun Context.versionName(): String = try {
    packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0)).versionName.orEmpty()
} catch (e: PackageManager.NameNotFoundException) {
    ""
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
            SectionTitle("Appearance")
            ThemePicker(state.theme, onThemeChange)

            SectionTitle("Account")
            // An email can be long, so it goes under its label instead of squeezing it.
            ListItem(
                leadingContent = { Icon(Icons.Outlined.Mail, contentDescription = null) },
                headlineContent = { Text("Email") },
                supportingContent = { Text(state.email ?: "Not logged in") },
            )
            InfoRow(Icons.Outlined.Inventory2, "Usage", state.usage, loading = state.usage == null)
            InfoRow(Icons.Outlined.WorkspacePremium, "Plan", state.plan ?: "", loading = state.usage == null)
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            ActionRow(
                icon = Icons.AutoMirrored.Outlined.Logout,
                label = if (state.isSigningOut) "Logging Out…" else "Log Out",
                enabled = !state.isSigningOut,
                onClick = onSignOut,
            )
            ActionRow(
                icon = Icons.Outlined.DeleteForever,
                label = if (state.isDeleting) "Deleting…" else "Delete Account",
                enabled = !state.isDeleting && !state.accountChangesPaused,
                destructive = true,
                onClick = onDelete,
            )

            SectionTitle("About")
            ListItem(
                headlineContent = { Text("Teak") },
                supportingContent = {
                    Text("by @praveenjuge. Hope you enjoy using Teak as much as I enjoyed creating it.")
                },
                trailingContent = { Text(versionName, style = MaterialTheme.typography.labelMedium) },
            )
            ActionRow(Icons.Outlined.Description, "Help & Docs", onClick = { onOpenLink("https://teakvault.com/docs") })
            ActionRow(Icons.Outlined.Policy, "Privacy Policy", onClick = { onOpenLink("https://teakvault.com/docs/privacy-policy") })
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

@Composable
private fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp)
            .semantics { heading() },
    )
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

@Composable
private fun InfoRow(icon: ImageVector, label: String, value: String?, loading: Boolean = false) {
    ListItem(
        leadingContent = { Icon(icon, contentDescription = null) },
        headlineContent = { Text(label) },
        trailingContent = {
            if (loading) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                Text(value.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
    )
}

@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    destructive: Boolean = false,
) {
    val color = when {
        !enabled -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
        destructive -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurface
    }
    ListItem(
        modifier = Modifier.clickable(enabled = enabled, onClick = onClick),
        leadingContent = { Icon(icon, contentDescription = null, tint = color) },
        headlineContent = { Text(label, color = color) },
        colors = ListItemDefaults.colors(),
    )
}
