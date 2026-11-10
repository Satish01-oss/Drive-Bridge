package app.devicebridge.remote

import org.junit.Assert.*
import org.junit.Test

class UpdatePolicyTest {
    private val update=AppUpdate("v0.9.0-preview.7","0.9.0-preview.7",907,"DeviceBridge-Android-0.9.0-preview.apk",1024,"a".repeat(64),"https://github.com/Satish01-oss/Drive-Bridge/releases/download/v0.9.0-preview.7/DeviceBridge-Android-0.9.0-preview.apk")
    private fun rejected(action:()->Unit){try{action();fail("Unsafe update accepted")}catch(_:IllegalArgumentException){}}
    @Test fun newerOfficialReleaseIsOfferedWithoutAllowingDowngrades(){assertTrue(UpdatePolicy.validate(update,906));assertFalse(UpdatePolicy.validate(update,907));assertFalse(UpdatePolicy.validate(update,908))}
    @Test fun foreignAssetsAndUnboundedDownloadsAreRejected(){rejected{UpdatePolicy.validate(update.copy(url="https://example.com/app.apk"),906)};rejected{UpdatePolicy.validate(update.copy(bytes=UpdatePolicy.MAX_APK_BYTES+1),906)};rejected{UpdatePolicy.validate(update.copy(version="9.0.0"),906)}}
    @Test fun redirectsCannotDowngradeTlsOrEscapeTheDownloadHosts(){assertTrue(UpdatePolicy.allowedRedirect("https://release-assets.githubusercontent.com/public/update?signature=temporary"));assertFalse(UpdatePolicy.allowedRedirect("http://github.com/update"));assertFalse(UpdatePolicy.allowedRedirect("https://github.com.attacker.test/update"));assertFalse(UpdatePolicy.allowedRedirect("https://user@github.com/update"))}
    @Test fun truncatedAndTamperedFilesNeverReachTheInstaller(){UpdatePolicy.verifyReceipt(update,1024,"a".repeat(64));rejected{UpdatePolicy.verifyReceipt(update,1023,"a".repeat(64))};rejected{UpdatePolicy.verifyReceipt(update,1024,"b".repeat(64))}}
    @Test fun packageVersionAndPublisherMustMatch(){UpdatePolicy.verifyPackage("app.devicebridge.remote",907,setOf("official"),setOf("official"),update,906);rejected{UpdatePolicy.verifyPackage("other.app",907,setOf("official"),setOf("official"),update,906)};rejected{UpdatePolicy.verifyPackage("app.devicebridge.remote",907,setOf("different"),setOf("official"),update,906)};rejected{UpdatePolicy.verifyPackage("app.devicebridge.remote",906,setOf("official"),setOf("official"),update,906)}}
}
