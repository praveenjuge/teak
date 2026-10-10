pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "teak-android"

include(":app")
include(":baselineprofile")
include(":core:model")
include(":core:data")
include(":core:designsystem")
include(":core:testing")
include(":feature:auth")
include(":feature:library")
include(":feature:card")
include(":feature:capture")
include(":feature:settings")
