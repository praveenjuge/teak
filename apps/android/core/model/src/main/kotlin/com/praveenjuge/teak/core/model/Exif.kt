package com.praveenjuge.teak.core.model

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
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
    /** Epoch ms, kept for released apps: an instant when the EXIF has an offset, else the camera's clock read as UTC. */
    val takenAt: Double? = null,
    /** The camera's clock time as epoch ms, read as if that clock were UTC. */
    val takenAtClock: Double? = null,
    /** Minutes east of UTC the camera recorded, when the EXIF has an offset. */
    val takenAtOffset: Double? = null,
)

/** A port of `apps/web/src/lib/exif.ts`. GPS is stored but never shown. */
object Exif {
    // Cameras write exposures of 0.3 s and longer as decimals; as fractions they'd round to the wrong speed.
    private const val DECIMAL_EXPOSURE_FROM_SECONDS = 0.3
    private const val MAX_OFFSET_MINUTES = 14 * 60
    private val WEB_TAKEN_AT = DateTimeFormatter.ofPattern("MMM d, yyyy, hh:mm a", Locale.US)
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

    /** "UTC+5:30", "UTC-8" or "UTC", or null without a believable offset. */
    private fun formatUtcOffset(minutes: Double?): String? {
        if (minutes == null || !minutes.isFinite() || minutes % 1.0 != 0.0 || abs(minutes) > MAX_OFFSET_MINUTES) return null
        val total = minutes.toInt()
        if (total == 0) return "UTC"
        val hours = abs(total) / 60
        val rest = abs(total) % 60
        val sign = if (total < 0) "-" else "+"
        return if (rest == 0) "UTC$sign$hours" else "UTC$sign$hours:${rest.toString().padStart(2, '0')}"
    }

    // takenAtClock is the camera's clock time encoded as UTC, so it's formatted in UTC:
    // a photo taken at 09:00 reads 09:00 wherever it's viewed. Photos processed before
    // takenAtClock existed keep their old reading of takenAt in the viewer's zone.
    /** The web's "May 17, 2026, 09:00 AM" in English; other languages put the date and time in their own order. */
    private fun takenAtFormat(locale: Locale): DateTimeFormatter =
        if (locale.language == Locale.ENGLISH.language) WEB_TAKEN_AT
        else DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)

    private fun formatTakenAt(exif: ImageExif, zone: ZoneId, locale: Locale): String? {
        val format = takenAtFormat(locale)
        positive(exif.takenAtClock)?.let { millis ->
            val clock = format.withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(millis.toLong()))
            return formatUtcOffset(exif.takenAtOffset)?.let { "$clock $it" } ?: clock
        }
        val millis = positive(exif.takenAt) ?: return null
        return format.withZone(zone).format(Instant.ofEpochMilli(millis.toLong()))
    }

    fun rows(exif: ImageExif?, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): List<DetailRow> {
        if (exif == null) return emptyList()
        return listOf(
            UiText.of("native.details.camera") to formatCamera(exif.make, exif.model),
            UiText.of("native.details.taken") to formatTakenAt(exif, zone, locale),
            UiText.of("native.details.exposure") to formatExposureTime(exif.exposureTime),
            UiText.of("native.details.aperture") to positive(exif.fNumber)?.let { "f/${trimDecimal(it)}" },
            UiText.of("native.details.focalLength") to positive(exif.focalLength)?.let { "${trimDecimal(it)} mm" },
            UiText.of("native.details.iso") to positive(exif.iso)?.let { it.roundToLong().toString() },
        ).mapNotNull { (label, value) -> value?.let { DetailRow(label, it) } }
    }
}
