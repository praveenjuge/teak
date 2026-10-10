plugins {
    alias(libs.plugins.teak.android.library)
    alias(libs.plugins.teak.hilt)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.praveenjuge.teak.core.data"
}

dependencies {
    api(project(":core:model"))
    api(libs.convex.android) {
        artifact { type = "aar" }
        isTransitive = true
        exclude(group = "net.java.dev.jna")
    }
    implementation(libs.jna) {
        artifact { type = "aar" }
    }
    implementation(libs.workos.android)
    implementation(libs.okhttp)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
