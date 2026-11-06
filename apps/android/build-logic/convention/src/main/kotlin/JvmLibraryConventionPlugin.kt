import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

class JvmLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.jvm")
            configureKotlinJvm()
            dependencies {
                add("testImplementation", libs.library("junit4"))
                add("testImplementation", libs.library("kotlin-test"))
            }
            // CI and the docs run `testDebugUnitTest`, the Android modules' task; a JVM module only has
            // `test`, so without this its tests never ran there.
            tasks.register("testDebugUnitTest") {
                group = "verification"
                description = "Runs this JVM module's unit tests alongside the Android modules' debug unit tests."
                dependsOn("test")
            }
        }
    }
}
