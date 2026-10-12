plugins {
    id("com.android.application")
}

// Signature : clé fournie par l'environnement (CI, secrets) ou, à défaut,
// la clé de développement versionnée pour que les mises à jour s'installent
// par-dessus les versions précédentes.
val releaseStore: String? = System.getenv("NOVA_KEYSTORE")

android {
    namespace = "com.idrissta.novagraph"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idrissta.novagraph"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("NOVA_VERSION_CODE") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("NOVA_VERSION_CODE") ?: "0")
    }

    signingConfigs {
        getByName("debug") {
            storeFile = file("nova-dev.keystore")
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
                storeFile = file("nova-dev.keystore")
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
}
