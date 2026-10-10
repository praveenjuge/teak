import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    alias(libs.plugins.teak.android.application)
    alias(libs.plugins.teak.android.compose)
    alias(libs.plugins.teak.hilt)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.baselineprofile)
    alias(libs.plugins.sentry)
}

// Every Teak surface ships the same version: the root package.json, set by `bun run release:prepare`.
val teakVersion: String = (JsonSlurper().parse(rootDir.resolve("../../package.json")) as Map<*, *>)["version"] as String

/** 1.0.85 -> 1000085. A Play-assigned build number can override it with -Pteak.versionCode=N. */
fun versionCodeFor(version: String): Int {
    val (major, minor, patch) = version.split('.').map { it.toInt() }
    return major * 1_000_000 + minor * 1_000 + patch
}

// The upload key stays outside the repository: keystore.properties locally, environment variables in CI.
val signingProperties = Properties().apply {
    rootDir.resolve("keystore.properties").takeIf { it.exists() }?.inputStream()?.use(::load)
}
fun signingValue(key: String, env: String): String? =
    signingProperties.getProperty(key) ?: System.getenv(env)?.takeIf { it.isNotBlank() }

android {
    namespace = "com.praveenjuge.teak"

    defaultConfig {
        applicationId = "com.praveenjuge.teak"
        versionName = teakVersion
        versionCode = providers.gradleProperty("teak.versionCode").orNull?.toInt() ?: versionCodeFor(teakVersion)
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Sentry stays off unless a DSN is supplied at build time, like the iPhone app.
        buildConfigField("String", "SENTRY_DSN", "\"${System.getenv("SENTRY_ANDROID_DSN").orEmpty()}\"")
    }

    signingConfigs {
        val storeFile = signingValue("storeFile", "TEAK_UPLOAD_KEYSTORE")
        if (storeFile != null) {
            create("upload") {
                this.storeFile = rootDir.resolve(storeFile)
                storePassword = signingValue("storePassword", "TEAK_UPLOAD_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "TEAK_UPLOAD_KEY_ALIAS")
                // A PKCS12 keystore uses one password for the store and the key.
                keyPassword = signingValue("keyPassword", "TEAK_UPLOAD_KEY_PASSWORD") ?: storePassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            resValue("string", "app_name", "Teak Dev")
            // The shared cloud dev deployment, signed in through WorkOS staging.
            buildConfigField("String", "CONVEX_URL", "\"https://reminiscent-kangaroo-59.convex.cloud\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            resValue("string", "app_name", "Teak")
            buildConfigField("String", "CONVEX_URL", "\"https://uncommon-ladybug-882.convex.cloud\"")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("upload")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
        // Keep native libraries uncompressed and page-aligned so they load from 16 KB-page devices.
        jniLibs.useLegacyPackaging = false
    }
}

sentry {
    org.set("teakvault")
    projectName.set("teak-android-prod")
    // Mapping files upload only when a release build has a token; local and debug builds stay offline.
    val hasToken = System.getenv("SENTRY_AUTH_TOKEN")?.isNotBlank() == true
    includeProguardMapping.set(hasToken)
    autoUploadProguardMapping.set(hasToken)
    uploadNativeSymbols.set(false)
    includeSourceContext.set(false)
    autoInstallation.enabled.set(false)
    telemetry.set(false)
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:data"))
    implementation(project(":core:designsystem"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:library"))
    implementation(project(":feature:card"))
    implementation(project(":feature:capture"))
    implementation(project(":feature:settings"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.compose.material3.adaptive.layout)
    implementation(libs.androidx.compose.material3.adaptive.navigation3)
    implementation(libs.androidx.compose.material3.navigation.suite)
    implementation(libs.androidx.hilt.lifecycle.viewmodel.compose)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.profileinstaller)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.coil.gif)
    implementation(libs.coil.video)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.sentry.android)
    baselineProfile(project(":baselineprofile"))

    testImplementation(project(":core:testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
