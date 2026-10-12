import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    alias(libs.plugins.teak.android.application)
    alias(libs.plugins.teak.android.compose)
    alias(libs.plugins.teak.hilt)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.baselineprofile)
    alias(libs.plugins.posthog)
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

// The PostHog project token is public, but it stays out of the repository so only release builds send events.
val posthogToken: String = providers.gradleProperty("POSTHOG_ANDROID_TOKEN")
    .orElse(providers.environmentVariable("POSTHOG_ANDROID_TOKEN"))
    .getOrElse("")
    .trim()

android {
    namespace = "com.praveenjuge.teak"

    defaultConfig {
        applicationId = "com.praveenjuge.teak"
        versionName = teakVersion
        versionCode = providers.gradleProperty("teak.versionCode").orNull?.toInt() ?: versionCodeFor(teakVersion)
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        val storeFile = signingValue("storeFile", "TEAK_UPLOAD_KEYSTORE")
        val storePassword = signingValue("storePassword", "TEAK_UPLOAD_KEYSTORE_PASSWORD")
        // Without both, release builds stay unsigned (as in CI) rather than failing.
        if (storeFile != null && storePassword != null) {
            create("upload") {
                this.storeFile = rootDir.resolve(storeFile)
                this.storePassword = storePassword
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
            buildConfigField("String", "POSTHOG_TOKEN", "\"\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            resValue("string", "app_name", "Teak")
            buildConfigField("String", "CONVEX_URL", "\"https://uncommon-ladybug-882.convex.cloud\"")
            // PostHog stays off unless a release build is given the project token, like the iPhone app.
            buildConfigField("String", "POSTHOG_TOKEN", "\"$posthogToken\"")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("upload")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    testOptions {
        // An Android 17 phone with 16 KB memory pages, like the devices Play now requires support for.
        // Run with ./gradlew :app:pixel9Api37DebugAndroidTest
        managedDevices.localDevices.create("pixel9Api37") {
            device = "Pixel 9"
            apiLevel = 37
            systemImageSource = "google_apis_playstore_ps16k"
        }
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
        // Keep native libraries uncompressed and page-aligned so they load from 16 KB-page devices.
        jniLibs.useLegacyPackaging = false
    }
}

// The PostHog plugin uploads the R8 mapping after every minified build through posthog-cli.
// Only builds with CLI credentials upload; local, CI test and unsigned builds stay offline.
val uploadsMappings = listOf("POSTHOG_CLI_API_KEY", "POSTHOG_CLI_PROJECT_ID").all {
    providers.environmentVariable(it).orNull?.isNotBlank() == true
}
tasks.matching { it.name.startsWith("uploadPostHogProguardMappings") }.configureEach {
    enabled = uploadsMappings
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
    implementation(libs.posthog.android)
    baselineProfile(project(":baselineprofile"))

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.core)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(project(":core:testing"))
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}
