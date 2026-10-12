plugins {
    id("com.android.application")
}

// Même logique de signature que Nova Graph : clé fournie par la CI (secrets)
// ou, à défaut, la clé de développement versionnée pour que chaque nouvelle
// version s'installe par-dessus la précédente.
val releaseStore: String? = System.getenv("NOVA_KEYSTORE")
val media3 = "1.5.1"

android {
    namespace = "com.idrissta.cinegenesis"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idrissta.cinegenesis"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("NOVA_VERSION_CODE") ?: "1").toInt()
        versionName = "2.0." + (System.getenv("NOVA_VERSION_CODE") ?: "0")
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("../app/nova-dev.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        create("release") {
            if (releaseStore != null) {
                storeFile = file(releaseStore)
                storePassword = System.getenv("NOVA_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NOVA_KEY_ALIAS")
                keyPassword = System.getenv("NOVA_KEY_PASSWORD")
            } else {
                storeFile = file("../app/nova-dev.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Les API « instables » de Media3 sont utilisées volontairement (effet GL d'upscale).
        disable += "UnsafeOptInUsageError"
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.media3:media3-transformer:$media3")
    implementation("androidx.media3:media3-effect:$media3")
    implementation("androidx.media3:media3-common:$media3")
}
