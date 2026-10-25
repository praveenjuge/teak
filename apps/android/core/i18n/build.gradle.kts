plugins {
    alias(libs.plugins.teak.android.library)
    alias(libs.plugins.teak.android.compose)
}

android {
    namespace = "com.praveenjuge.teak.core.i18n"
}

dependencies {
    api(project(":core:model"))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.core.ktx)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
