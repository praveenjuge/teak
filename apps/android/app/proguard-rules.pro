# Convex's native client is reached through JNA and UniFFI callbacks.
-keep class dev.convex.android.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn java.awt.**

# Models decoded with kotlinx.serialization.
-keepclassmembers @kotlinx.serialization.Serializable class com.praveenjuge.teak.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}

# The WorkOS SDK's optional JWT verification pulls in classes Android doesn't ship.
-dontwarn com.google.crypto.tink.**
-dontwarn net.jcip.annotations.**
-dontwarn org.bouncycastle.**
-dontwarn javax.naming.**
