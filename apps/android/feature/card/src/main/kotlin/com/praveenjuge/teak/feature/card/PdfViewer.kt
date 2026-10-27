package com.praveenjuge.teak.feature.card

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.praveenjuge.teak.core.i18n.resolve
import com.praveenjuge.teak.core.i18n.tr

private val MaxPageWidth = 840.dp
private val PageShape = RoundedCornerShape(4.dp)

/** A card's PDF, page by page, in the app; "Open in another app" hands it to a PDF reader. */
@Composable
fun PdfViewerRoute(cardId: String, onBack: () -> Unit) {
    val viewModel = hiltViewModel<PdfViewerViewModel, PdfViewerViewModel.Factory>(
        key = "pdf:$cardId",
        creationCallback = { it.create(cardId) },
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    PdfViewerScreen(
        state = state,
        onBack = onBack,
        onRetry = viewModel::retry,
        onOpenElsewhere = { context.openPdfElsewhere(state.file?.let(viewModel::contentUri), state.fileUrl) },
        renderPage = viewModel::render,
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun PdfViewerScreen(
    state: PdfViewerUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onOpenElsewhere: () -> Unit,
    renderPage: suspend (index: Int, widthPx: Int) -> Bitmap?,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.title?.resolve().orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("common.back")) }
                },
                actions = {
                    IconButton(onClick = onOpenElsewhere, enabled = state.fileUrl != null) {
                        Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = tr("android.card.openInAnotherApp"))
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).background(MaterialTheme.colorScheme.surfaceContainer)) {
            when (val load = state.load) {
                PdfLoad.Loading -> Column(
                    Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    LoadingIndicator()
                    Text(tr("native.media.pdfLoading"), style = MaterialTheme.typography.bodyMedium)
                }
                PdfLoad.Failed -> Column(
                    Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(tr("native.media.pdfFailed"), style = MaterialTheme.typography.bodyLarge)
                    FilledTonalButton(onClick = onRetry) { Text(tr("common.tryAgain")) }
                    if (state.fileUrl != null) TextButton(onClick = onOpenElsewhere) { Text(tr("android.card.openInAnotherApp")) }
                }
                is PdfLoad.Ready -> PdfPages(load.pages, renderPage)
            }
        }
    }
}

@Composable
private fun PdfPages(pages: List<PdfPageSize>, renderPage: suspend (index: Int, widthPx: Int) -> Bitmap?) {
    val listState = rememberLazyListState()
    val current by remember { derivedStateOf { listState.firstVisibleItemIndex + 1 } }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            itemsIndexed(pages) { index, size ->
                PdfPage(index, pages.size, size, renderPage)
            }
        }
        if (pages.size > 1) {
            Surface(
                shape = RoundedCornerShape(50),
                color = MaterialTheme.colorScheme.inverseSurface.copy(alpha = 0.85f),
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
            ) {
                Text(
                    tr("native.media.pdfPage", current.toString(), pages.size.toString()),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
        }
    }
}

/** One page, rendered once it's on screen at the width it's shown, so memory stays at a few pages. */
@Composable
private fun PdfPage(index: Int, count: Int, size: PdfPageSize, renderPage: suspend (index: Int, widthPx: Int) -> Bitmap?) {
    val label = tr("native.media.pdfPage", (index + 1).toString(), count.toString())
    BoxWithConstraints(
        Modifier
            .widthIn(max = MaxPageWidth)
            .fillMaxWidth()
            .aspectRatio(size.ratio)
            .clip(PageShape)
            .background(Color.White)
            .semantics { contentDescription = label },
    ) {
        val widthPx = with(LocalDensity.current) { maxWidth.roundToPx() }
        val bitmap by produceState<Bitmap?>(null, index, widthPx) { value = renderPage(index, widthPx) }
        bitmap?.let {
            Image(it.asImageBitmap(), contentDescription = null, contentScale = ContentScale.FillBounds, modifier = Modifier.fillMaxSize())
        }
    }
}

private fun Context.openPdfElsewhere(localUri: Uri?, remoteUrl: String?) {
    if (localUri != null) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(localUri, "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            startActivity(intent)
            return
        } catch (_: ActivityNotFoundException) {
            // No PDF app: the browser can still show the file.
        }
    }
    val url = safeExternalUrl(remoteUrl) ?: return
    if (!openInCustomTab(url)) Toast.makeText(this, resources.tr("android.card.noAppForLink"), Toast.LENGTH_SHORT).show()
}
