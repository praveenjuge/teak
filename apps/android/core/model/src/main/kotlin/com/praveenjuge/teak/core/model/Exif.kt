package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong

@Serializable
data class ImageExif(
    val exposureTime: Double? = null,
    val fNumber: Double? = null,
    val focalLength: Double? = null,
    val iso: Double? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val make: String? = null,
    val model: String? = null,
    val takenAt: Double? = null,
)

/** A port of `apps/web/src/lib/exif.ts`. GPS is stored but never shown. */
object Exif {
    // Cameras write exposures of 0.3 s and longer as decimals; as fractions they'd round to the wrong speed.
    private const val DECIMAL_EXPOSURE_FROM_SECONDS = 0.3
    private val WHITESPACE = Regex("\\s+")

    private fun positive(value: Double?): Double? = value?.takeIf { it.isFinite() && it > 0 }

    private fun clean(value: String?): String = value?.replace(WHITESPACE, " ")?.trim().orEmpty()

    private fun trimDecimal(value: Double): String {
        val tenths = (value * 10).roundToLong() / 10.0
        return if (tenths % 1.0 == 0.0) tenths.toLong().toString() else tenths.toString()
    }

    fun formatCamera(make: String?, model: String?): String? {
        val cleanMake = clean(make)
        val cleanModel = clean(model)
        if (cleanModel.isEmpty()) return cleanMake.ifEmpty { null }
        if (cleanMake.isEmpty() || cleanModel.lowercase().startsWith(cleanMake.lowercase().split(" ")[0])) return cleanModel
        return "$cleanMake $cleanModel"
    }

    fun formatExposureTime(seconds: Double?): String? {
        val value = positive(seconds) ?: return null
        if (value >= DECIMAL_EXPOSURE_FROM_SECONDS) return "${trimDecimal(value)} s"
        return "1/${(1 / value).roundToLong()} s"
    }

    private fun formatTakenAt(takenAt: Double?, zone: ZoneId): String? {
        val millis = positive(takenAt) ?: return null
        return DateTimeFormatter.ofPattern("MMM d, yyyy, hh:mm a", Locale.US)
            .withZone(zone)
            .format(Instant.ofEpochMilli(millis.toLong()))
    }

    fun rows(exif: ImageExif?, zone: ZoneId = ZoneId.systemDefault()): List<DetailRow> {
        if (exif == null) return emptyList()
        return listOf(
            "Camera" to formatCamera(exif.make, exif.model),
            "Taken" to formatTakenAt(exif.takenAt, zone),
            "Exposure" to formatExposureTime(exif.exposureTime),
            "Aperture" to positive(exif.fNumber)?.let { "f/${trimDecimal(it)}" },
            "Focal length" to positive(exif.focalLength)?.let { "${trimDecimal(it)} mm" },
            "ISO" to positive(exif.iso)?.let { it.roundToLong().toString() },
        ).mapNotNull { (label, value) -> value?.let { DetailRow(label, it) } }
    }
}
