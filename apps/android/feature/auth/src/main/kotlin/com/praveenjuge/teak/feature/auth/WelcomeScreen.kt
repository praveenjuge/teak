package com.praveenjuge.teak.feature.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.data.auth.SignInMethod
import com.praveenjuge.teak.core.designsystem.R as DesignR
import com.praveenjuge.teak.core.model.TeakMessages

@Composable
fun WelcomeRoute(viewModel: WelcomeViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.openUrl.collect { url -> openAuthKit(context, url) }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.onReturnedWithoutRedirect() }
    WelcomeScreen(state = state, onSignIn = viewModel::signIn, onDismissError = viewModel::dismissError)
}

private fun openAuthKit(context: Context, url: String) {
    CustomTabsIntent.Builder()
        .setShowTitle(true)
        .setUrlBarHidingEnabled(true)
        .build()
        .launchUrl(context, Uri.parse(url))
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun WelcomeScreen(
    state: WelcomeUiState,
    onSignIn: (SignInMethod) -> Unit,
    onDismissError: () -> Unit,
) {
    Scaffold { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
            Column(
                modifier = Modifier
                    .widthIn(max = 420.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Image(
                    painter = painterResource(DesignR.drawable.teak_logo),
                    contentDescription = "Teak",
                    modifier = Modifier.size(112.dp),
                )
                Spacer(Modifier.height(24.dp))
                Text(
                    "Save Anything. Anywhere.",
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "Your personal everything management system. Organize, save, and access all your text, images, and documents in one place.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(40.dp))
                if (!state.isConfigured) {
                    LoadingIndicator()
                    return@Column
                }
                val busy = state.pending != null
                SignInButton("Continue with Google", SignInMethod.Google, state, primary = true, onSignIn = onSignIn)
                SignInButton("Continue with Apple", SignInMethod.Apple, state, onSignIn = onSignIn)
                if (state.signupsDisabled) {
                    Text(
                        TeakMessages.SIGNUPS_PAUSED,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                } else {
                    OutlinedButton(
                        onClick = { onSignIn(SignInMethod.EmailSignUp) },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).height(56.dp),
                    ) {
                        Icon(Icons.Outlined.PersonAdd, contentDescription = null)
                        Spacer(Modifier.size(ButtonDefaults.IconSpacing))
                        Text(if (state.pending == SignInMethod.EmailSignUp) "Signing in…" else "Register with Email")
                    }
                }
                TextButton(
                    onClick = { onSignIn(SignInMethod.EmailSignIn) },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).height(56.dp),
                ) {
                    Icon(Icons.Outlined.Email, contentDescription = null)
                    Spacer(Modifier.size(ButtonDefaults.IconSpacing))
                    Text(if (state.pending == SignInMethod.EmailSignIn) "Signing in…" else "Login with Email")
                }
            }
        }
    }
    state.error?.let { message ->
        AlertDialog(
            onDismissRequest = onDismissError,
            title = { Text("Sign In Failed") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = onDismissError) { Text("OK") } },
        )
    }
}

@Composable
private fun SignInButton(
    label: String,
    method: SignInMethod,
    state: WelcomeUiState,
    onSignIn: (SignInMethod) -> Unit,
    primary: Boolean = false,
) {
    val text = if (state.pending == method) "Signing in…" else label
    val modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp).height(56.dp)
    if (primary) {
        Button(onClick = { onSignIn(method) }, enabled = state.pending == null, modifier = modifier) { Text(text) }
    } else {
        FilledTonalButton(onClick = { onSignIn(method) }, enabled = state.pending == null, modifier = modifier) { Text(text) }
    }
}

