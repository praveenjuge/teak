package com.praveenjuge.teak.feature.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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

/** Sign-in: the wordmark up top, the pitch and the ways in at the bottom, within thumb reach. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun WelcomeScreen(
    state: WelcomeUiState,
    onSignIn: (SignInMethod) -> Unit,
    onDismissError: () -> Unit,
) {
    Scaffold(containerColor = MaterialTheme.colorScheme.surface) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(
                modifier = Modifier
                    .widthIn(max = 440.dp)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 28.dp, vertical = 24.dp),
            ) {
                Image(
                    painter = painterResource(DesignR.drawable.teak_wordmark),
                    contentDescription = "Teak",
                    modifier = Modifier.padding(top = 16.dp).height(32.dp),
                )
                Spacer(Modifier.weight(1f).heightIn(min = 48.dp))
                Text(
                    "Save Anything. Anywhere.",
                    style = MaterialTheme.typography.displaySmall.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.5).sp,
                        lineHeight = 44.sp,
                    ),
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    "Your personal everything management system. Organize, save, and access all your text, images, and documents in one place.",
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(40.dp))
                if (state.isConfigured) {
                    SignInOptions(state, onSignIn)
                } else {
                    Box(Modifier.fillMaxWidth().height(184.dp), contentAlignment = Alignment.Center) {
                        LoadingIndicator()
                    }
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SignInOptions(state: WelcomeUiState, onSignIn: (SignInMethod) -> Unit) {
    val busy = state.pending != null
    fun label(method: SignInMethod, text: String) = if (state.pending == method) "Signing in…" else text

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Apple asks for a black button (white in dark mode); Google for a neutral one with its G.
        Button(
            onClick = { onSignIn(SignInMethod.Apple) },
            enabled = !busy,
            shape = ButtonShape,
            colors = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) {
                ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)
            } else {
                ButtonDefaults.buttonColors(containerColor = Color.Black, contentColor = Color.White)
            },
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Icon(painterResource(R.drawable.ic_apple), contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(12.dp))
            Text(label(SignInMethod.Apple, "Continue with Apple"), style = ButtonText)
        }
        OutlinedButton(
            onClick = { onSignIn(SignInMethod.Google) },
            enabled = !busy,
            shape = ButtonShape,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurface),
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(12.dp))
            Text(label(SignInMethod.Google, "Continue with Google"), style = ButtonText)
        }
        if (state.signupsDisabled) {
            Text(
                TeakMessages.SIGNUPS_PAUSED,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.Center,
            verticalArrangement = Arrangement.Center,
        ) {
            if (!state.signupsDisabled) {
                EmailLink(label(SignInMethod.EmailSignUp, "Register with Email"), enabled = !busy) {
                    onSignIn(SignInMethod.EmailSignUp)
                }
                Text(
                    "·",
                    color = MaterialTheme.colorScheme.outline,
                    modifier = Modifier.align(Alignment.CenterVertically).clearAndSetSemantics {},
                )
            }
            EmailLink(label(SignInMethod.EmailSignIn, "Login with Email"), enabled = !busy) {
                onSignIn(SignInMethod.EmailSignIn)
            }
        }
    }
}

@Composable
private fun EmailLink(text: String, enabled: Boolean, onClick: () -> Unit) {
    TextButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp)) {
        Text(text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold))
    }
}

private val ButtonShape = RoundedCornerShape(16.dp)

private val ButtonText: TextStyle
    @Composable get() = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
