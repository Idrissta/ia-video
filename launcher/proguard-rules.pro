# Méthodes appelées depuis JavaScript via addJavascriptInterface
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
