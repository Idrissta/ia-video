plugins {
    id("com.android.application")
}

// Même logique de signature que les autres applications : clé fournie par la
// CI (secrets) ou, à défaut, la clé de développement versionnée pour que
// chaque nouvelle version s'installe par-dessus la précédente.
val releaseStore: String? = System.getenv("NOVA_KEYSTORE")
val buildNumber = System.getenv("NOVA_VERSION_CODE") ?: "1"

android {
    namespace = "com.idrissta.velochampion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.idrissta.velochampion"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber.toInt()
        versionName = "1.0.$buildNumber"
        manifestPlaceholders["appLabel"] = "Vélo Champion"
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
        // Version de test : installable à côté de la vraie, achats simulés.
        debug {
            applicationIdSuffix = ".test"
            versionNameSuffix = "-test"
            manifestPlaceholders["appLabel"] = "Vélo Champion TEST"
        }
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

dependencies {
    // Paiements intégrés Google Play (achat des vélos).
    implementation("com.android.billingclient:billing:8.0.0")
}
