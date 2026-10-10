plugins {
    alias(libs.plugins.teak.android.feature)
}

android {
    namespace = "com.praveenjuge.teak.feature.card"
}

dependencies {
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.browser)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.ui.compose)
    implementation(libs.androidx.media3.ui.compose.material3)
}
