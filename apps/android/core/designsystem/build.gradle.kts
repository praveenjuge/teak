plugins {
    alias(libs.plugins.teak.android.library)
    alias(libs.plugins.teak.android.compose)
}

android {
    namespace = "com.praveenjuge.teak.core.designsystem"
}

dependencies {
    api(libs.androidx.compose.ui)
    api(libs.androidx.compose.material3)
    api(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.core.ktx)
}
