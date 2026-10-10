plugins {
    alias(libs.plugins.teak.android.feature)
}

android {
    namespace = "com.praveenjuge.teak.feature.auth"
}

dependencies {
    implementation(libs.androidx.browser)
}
