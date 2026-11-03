plugins {
    id("com.android.application")
}

// Même signature que les autres applis du dépôt : clé fournie par la CI (secrets)
// ou, à défaut, la clé de développement versionnée dans app/.
val releaseStore: String? = System.getenv("NOVA_KEYSTORE")
val devStore = rootProject.file("app/nova-dev.keystore")

android {
    namespace = "com.idrissta.craftapps"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idrissta.craftapps"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("NOVA_VERSION_CODE") ?: "1").toInt()
        // 0.13.0 : version d'ArtCraft Launcher embarquée (assets/web).
        versionName = "0.13.0." + (System.getenv("NOVA_VERSION_CODE") ?: "0")
    }

    signingConfigs {
        getByName("debug") {
            storeFile = devStore
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
                storeFile = devStore
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

    // Le .wasm est déjà optimisé : le compresser dans l'APK ne fait que ralentir son chargement.
    androidResources {
        noCompress += "wasm"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
