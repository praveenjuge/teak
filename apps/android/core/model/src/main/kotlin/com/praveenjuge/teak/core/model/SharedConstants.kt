package com.praveenjuge.teak.core.model

const val FREE_TIER_LIMIT = 200

const val MAX_FILE_SIZE: Long = 104857600L

const val MAX_FILES_PER_UPLOAD = 20

const val SIGNUPS_PAUSED_MESSAGE = "New sign-ups are paused right now. Please try again later."

val CARD_TYPES: List<String> = listOf(
    "text",
    "link",
    "image",
    "video",
    "audio",
    "document",
    "palette",
    "quote",
)

val CARD_TYPE_LABELS: Map<String, String> = mapOf(
    "text" to "Text",
    "link" to "Link",
    "image" to "Image",
    "video" to "Video",
    "audio" to "Audio",
    "document" to "Document",
    "palette" to "Palette",
    "quote" to "Quote",
)

val COLOR_HUE_BUCKETS: List<String> = listOf(
    "red",
    "orange",
    "yellow",
    "green",
    "teal",
    "cyan",
    "blue",
    "purple",
    "pink",
    "brown",
    "neutral",
)

val COLOR_HUE_LABELS: Map<String, String> = mapOf(
    "red" to "Red",
    "orange" to "Orange",
    "yellow" to "Yellow",
    "green" to "Green",
    "teal" to "Teal",
    "cyan" to "Cyan",
    "blue" to "Blue",
    "purple" to "Purple",
    "pink" to "Pink",
    "brown" to "Brown",
    "neutral" to "Neutral",
)
