plugins {
    alias(libs.plugins.teak.android.library)
}

android {
    namespace = "com.praveenjuge.teak.core.testing"
}

dependencies {
    api(project(":core:model"))
    api(project(":core:data"))
    api(libs.junit4)
    api(libs.kotlinx.coroutines.test)
    api(libs.kotlin.test)
    api(libs.turbine)
}
