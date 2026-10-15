plugins {
    id("com.android.application")
}

// Même signature que les autres applications du dépôt : clé fournie par la CI
// (secrets) ou, à défaut, la clé de développement versionnée.
val releaseStore: String? = System.getenv("NOVA_KEYSTORE")
val buildNumber = System.getenv("NOVA_VERSION_CODE") ?: "1"

android {
    namespace = "com.idrissta.prono"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idrissta.pronofoot"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber.toInt()
        versionName = "1.0.$buildNumber"
    }

    buildFeatures {
        buildConfig = true
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
}
