plugins { id("com.android.application") }
android {
    namespace = "app.devicebridge.remote"
    compileSdk = 37
    defaultConfig { applicationId = "app.devicebridge.remote"; minSdk = 26; targetSdk = 37; versionCode = 906; versionName = "0.9.0-preview.6" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    sourceSets.getByName("main").assets.srcDir("../../remote/bundle")
    signingConfigs {
        if(System.getenv("DEVICEBRIDGE_ANDROID_KEYSTORE") != null) create("releaseIdentity") {
            storeFile = file(System.getenv("DEVICEBRIDGE_ANDROID_KEYSTORE")); storePassword = System.getenv("DEVICEBRIDGE_ANDROID_KEYSTORE_PASSWORD")
            keyAlias = "devicebridge"; keyPassword = System.getenv("DEVICEBRIDGE_ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes { getByName("release") { isMinifyEnabled = false; if(signingConfigs.findByName("releaseIdentity") != null) signingConfig = signingConfigs.getByName("releaseIdentity") } }
}
dependencies { implementation("androidx.webkit:webkit:1.16.0"); implementation("androidx.core:core:1.17.0"); implementation("org.bouncycastle:bcprov-jdk18on:1.86"); testImplementation("junit:junit:4.13.2") }
