plugins {
    alias(libs.plugins.teak.jvm.library)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(libs.kotlinx.serialization.json)
}

// The test cases the TypeScript tests and Apple's TeakCore tests read too.
sourceSets.named("test") {
    resources.srcDir(rootDir.resolve("../../packages/convex/__tests__/shared/fixtures"))
}
