package app.devicebridge.remote

import java.net.URI

data class AppUpdate(val tag:String,val version:String,val versionCode:Long,val filename:String,val bytes:Long,val sha256:String,val url:String)

object UpdatePolicy {
    const val MAX_APK_BYTES=100L*1024*1024
    const val MANIFEST_URL="https://satish01-oss.github.io/Drive-Bridge/android-update.json"
    fun validate(update:AppUpdate,currentVersion:Long):Boolean {
        require(Regex("v[0-9]+\\.[0-9]+\\.[0-9]+(?:-preview\\.[0-9]+)?").matches(update.tag)){"Invalid update version"}
        require(update.versionCode in 1..Int.MAX_VALUE.toLong()){"Invalid Android version"}
        require(update.version==update.tag.removePrefix("v")){"Update version does not match its release"}
        val base=update.tag.removePrefix("v").substringBefore("-")
        require(update.filename=="DeviceBridge-Android-$base"+(if(update.tag.contains("-preview."))"-preview" else "")+".apk"){"Unexpected update file"}
        require(update.bytes in 1..MAX_APK_BYTES&&Regex("[a-f0-9]{64}").matches(update.sha256)){"Invalid update integrity information"}
        val expected="https://github.com/Satish01-oss/Drive-Bridge/releases/download/${update.tag}/${update.filename}"
        require(update.url==expected){"Updates must come from the official DeviceBridge release"}
        return update.versionCode>currentVersion
    }
    fun allowedRedirect(url:String):Boolean = try {
        val uri=URI(url)
        uri.scheme=="https"&&uri.userInfo==null&&(uri.port==-1||uri.port==443)&&uri.host in setOf("github.com","release-assets.githubusercontent.com","objects.githubusercontent.com","github-releases.githubusercontent.com","satish01-oss.github.io")
    }catch(_:Exception){false}
    fun verifyReceipt(update:AppUpdate,bytes:Long,sha256:String){require(bytes==update.bytes&&sha256==update.sha256){"Update download is incomplete or its checksum does not match"}}
    fun verifyPackage(packageName:String,versionCode:Long,signers:Set<String>,installedSigners:Set<String>,update:AppUpdate,currentVersion:Long){
        require(packageName=="app.devicebridge.remote"&&versionCode==update.versionCode&&versionCode>currentVersion){"This file is not a newer DeviceBridge app"}
        require(signers.isNotEmpty()&&signers==installedSigners){"Update publisher does not match the installed app"}
    }
}
