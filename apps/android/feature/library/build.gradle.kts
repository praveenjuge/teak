plugins {
    alias(libs.plugins.teak.android.feature)
}

android {
    namespace = "com.praveenjuge.teak.feature.library"
}

dependencies {
    implementation(libs.androidx.activity.compose)
    implementation(libs.coil.compose)
}
