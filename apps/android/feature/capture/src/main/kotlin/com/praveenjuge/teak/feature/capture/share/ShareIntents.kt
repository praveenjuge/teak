package com.praveenjuge.teak.feature.capture.share

import android.content.Intent
import android.net.Uri
import androidx.core.content.IntentCompat
import com.praveenjuge.teak.core.model.SaveLink

/** One thing handed to Teak to save. */
sealed interface ShareItem {
    data class Text(val text: String) : ShareItem
    data class File(val uri: Uri) : ShareItem
}

/** Reads what another app shared, selected, or linked into the items Teak saves. */
object ShareIntents {
    fun items(intent: Intent): List<ShareItem> = when (intent.action) {
        Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> sharedItems(intent)
        Intent.ACTION_PROCESS_TEXT -> listOfNotNull(
            intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.textItem(),
        )
        // Read the raw link: Uri.getQueryParameter turns a literal + into a space.
        Intent.ACTION_VIEW -> listOfNotNull(SaveLink.text(intent.dataString).textItem())
        else -> emptyList()
    }

    /**
     * The reply for an editable text selection: the same text, so the other app keeps it as it was.
     * Null for anything else, including read-only selections.
     */
    fun processTextReply(intent: Intent): Intent? {
        if (intent.action != Intent.ACTION_PROCESS_TEXT) return null
        if (intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)) return null
        val text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT) ?: return null
        return Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text)
    }

    private fun sharedItems(intent: Intent): List<ShareItem> {
        val files = streams(intent).map(ShareItem::File)
        // The subject only stands in when nothing else came with the share.
        val text = sharedText(intent)
            ?: intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { files.isEmpty() }
        return listOfNotNull(text?.textItem()) + files
    }

    // Some apps send SEND_MULTIPLE text as a list, one entry per item.
    private fun sharedText(intent: Intent): String? =
        intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            ?: intent.getCharSequenceArrayListExtra(Intent.EXTRA_TEXT)?.joinToString("\n")

    private fun streams(intent: Intent): List<Uri> {
        val fromExtras = if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        } else {
            listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        }
        val fromClip = intent.clipData?.let { clip -> (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri } }.orEmpty()
        return (fromExtras + fromClip).distinct()
    }

    private fun String.textItem(): ShareItem.Text? = trim().takeIf { it.isNotEmpty() }?.let(ShareItem::Text)
}
