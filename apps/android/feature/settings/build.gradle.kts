plugins {
    alias(libs.plugins.teak.android.feature)
}

android {
    namespace = "com.praveenjuge.teak.feature.settings"
}

dependencies {
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core.ktx)
}
