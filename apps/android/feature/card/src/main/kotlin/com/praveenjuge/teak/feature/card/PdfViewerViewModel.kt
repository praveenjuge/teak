package com.praveenjuge.teak.feature.card

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.graphics.createBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.praveenjuge.teak.core.data.catchingFailures
import com.praveenjuge.teak.core.data.repository.CardsRepository
import com.praveenjuge.teak.core.model.CardSheet
import com.praveenjuge.teak.core.model.UiText
import dagger.assisted.Assisted
import dagger.assisted.AssistedFactory
import dagger.assisted.AssistedInject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.File
import java.io.IOException

/** A page's size in PDF points, for laying out the page before it's rendered. */
data class PdfPageSize(val width: Int, val height: Int) {
    val ratio: Float get() = width.coerceAtLeast(1).toFloat() / height.coerceAtLeast(1)
}

sealed interface PdfLoad {
    data object Loading : PdfLoad
    data object Failed : PdfLoad
    data class Ready(val pages: List<PdfPageSize>) : PdfLoad
}

data class PdfViewerUiState(
    val title: UiText? = null,
    /** The card's file, which "Open in another app" falls back to before the download finishes. */
    val fileUrl: String? = null,
    /** The downloaded PDF, shared with other apps through a content URI. */
    val file: File? = null,
    val load: PdfLoad = PdfLoad.Loading,
)

/**
 * Reads a card's PDF in the app: downloads it to the cache once, then renders pages on demand at the width
 * they're shown, off the main thread.
 */
@HiltViewModel(assistedFactory = PdfViewerViewModel.Factory::class)
class PdfViewerViewModel @AssistedInject constructor(
    @Assisted private val cardId: String,
    private val repository: CardsRepository,
    private val files: CardFiles,
) : ViewModel() {
    private val _uiState = MutableStateFlow(PdfViewerUiState())
    val uiState: StateFlow<PdfViewerUiState> = _uiState.asStateFlow()

    private var document: OpenPdf? = null

    init {
        load()
    }

    fun retry() {
        if (_uiState.value.load == PdfLoad.Failed) load()
    }

    /** Renders page [index] [widthPx] wide, or null when the PDF is closed or the page can't render. */
    suspend fun render(index: Int, widthPx: Int): Bitmap? = withContext(Dispatchers.IO) {
        runCatching { document?.render(index, widthPx) }.getOrNull()
    }

    fun contentUri(file: File): Uri = files.contentUri(file)

    private fun load() {
        _uiState.update { it.copy(load = PdfLoad.Loading) }
        viewModelScope.launch {
            catchingFailures {
                val card = repository.card(cardId).first().getOrThrow() ?: throw IOException("The card is gone")
                val url = safeExternalUrl(card.fileUrl) ?: throw IOException("The card has no file")
                _uiState.update { it.copy(title = CardSheet.title(card), fileUrl = url) }
                val file = files.cachedDocument(url, card.id, "pdf")
                file to withContext(Dispatchers.IO) { OpenPdf.open(file) }
            }
                .onSuccess { (file, opened) ->
                    document?.close()
                    document = opened
                    _uiState.update { it.copy(file = file, load = PdfLoad.Ready(opened.pages)) }
                }
                .onFailure { _uiState.update { it.copy(load = PdfLoad.Failed) } }
        }
    }

    override fun onCleared() {
        document?.close()
    }

    @AssistedFactory
    interface Factory {
        fun create(cardId: String): PdfViewerViewModel
    }
}

/** An open PDF. PdfRenderer has one page open at a time, so rendering and closing take turns. */
private class OpenPdf(private val descriptor: ParcelFileDescriptor, private val renderer: PdfRenderer) : Closeable {
    val pages: List<PdfPageSize> = (0 until renderer.pageCount).map { index ->
        renderer.openPage(index).use { PdfPageSize(it.width, it.height) }
    }
    private var closed = false

    fun render(index: Int, widthPx: Int): Bitmap? = synchronized(this) {
        if (closed || index !in pages.indices) return null
        // Rendered no wider than a large phone screen, so a few pages stay well inside the memory budget.
        val width = widthPx.coerceIn(1, MAX_PAGE_WIDTH_PX)
        val height = (width / pages[index].ratio).toInt().coerceIn(1, MAX_PAGE_WIDTH_PX * 4)
        val bitmap = createBitmap(width, height)
        bitmap.eraseColor(Color.WHITE)
        renderer.openPage(index).use { it.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
        bitmap
    }

    override fun close() {
        synchronized(this) {
            if (closed) return
            closed = true
            renderer.close()
            descriptor.close()
        }
    }

    companion object {
        const val MAX_PAGE_WIDTH_PX = 1600

        fun open(file: File): OpenPdf {
            val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            var opened: OpenPdf? = null
            try {
                // A damaged or locked PDF throws here; the file is closed and the error goes to the caller.
                opened = OpenPdf(descriptor, PdfRenderer(descriptor))
                return opened
            } finally {
                if (opened == null) descriptor.close()
            }
        }
    }
}
