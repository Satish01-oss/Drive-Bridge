package app.devicebridge.remote

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

class UpdateFileProvider:FileProvider()

class AppUpdater(private val activity:Activity) {
    private var candidate:AppUpdate?=null
    private var verified:File?=null
    private fun version(info:PackageInfo):Long=if(Build.VERSION.SDK_INT>=28)info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    private fun packageFlags()=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
    private fun installed()=activity.packageManager.getPackageInfo(activity.packageName,packageFlags())
    private fun hex(bytes:ByteArray)=bytes.joinToString(""){"%02x".format(it)}
    private fun signers(info:PackageInfo):Set<String>{
        val signatures=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") info.signatures
        return signatures.orEmpty().map{hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray()))}.toSet()
    }
    private fun download(url:String,limit:Long,consume:(ByteArray,Int)->Unit):Long {
        var current=url;val started=System.nanoTime()
        repeat(6){
            require(UpdatePolicy.allowedRedirect(current)){"The update server redirected to an unsupported address"}
            val connection=URL(current).openConnection() as HttpsURLConnection
            connection.instanceFollowRedirects=false;connection.connectTimeout=10000;connection.readTimeout=15000;connection.setRequestProperty("Accept-Encoding","identity")
            try {
                val code=connection.responseCode
                if(code in setOf(301,302,303,307,308)){
                    val location=connection.getHeaderField("Location")?:error("Invalid update redirect")
                    current=URL(URL(current),location).toString()
                }else{
                    require(code==200){"The update server is unavailable. Try again later."}
                    require(connection.contentLengthLong<=limit){"The update file is too large"}
                    var count=0L
                    connection.inputStream.use{input->val buffer=ByteArray(32768);while(true){
                        require(!Thread.currentThread().isInterrupted&&(System.nanoTime()-started)/1_000_000<120000){"Update download timed out"}
                        val n=input.read(buffer);if(n<0)break;count+=n;require(count<=limit){"The update file is too large"};consume(buffer,n)
                    }}
                    return count
                }
            }finally{connection.disconnect()}
        }
        error("Too many update redirects")
    }
    @Synchronized fun check():JSONObject {
        val bytes=java.io.ByteArrayOutputStream();download(UpdatePolicy.MANIFEST_URL,128*1024){part,n->bytes.write(part,0,n)}
        val manifest=JSONObject(bytes.toString("UTF-8"));val apk=manifest.getJSONObject("android");val local=installed()
        val update=AppUpdate(manifest.getString("tag"),apk.getString("versionName"),apk.getLong("versionCode"),apk.getString("filename"),apk.getLong("bytes"),apk.getString("sha256"),apk.getString("url"))
        val available=UpdatePolicy.validate(update,version(local));candidate=if(available)update else null
        return JSONObject().put("available",available).put("currentVersion",local.versionName).put("version",update.version).put("bytes",update.bytes)
    }
    @Synchronized fun prepare():JSONObject {
        val update=candidate?:error("Check for an update first")
        require(UpdatePolicy.validate(update,version(installed()))){"This app is already up to date"}
        val directory=File(activity.cacheDir,"updates").apply{mkdirs()};val partial=File(directory,"update.part");val target=File(directory,"DeviceBridge-update.apk")
        verified=null;val digest=MessageDigest.getInstance("SHA-256")
        try {
            val count=partial.outputStream().use{output->download(update.url,update.bytes){part,n->output.write(part,0,n);digest.update(part,0,n)}}
            UpdatePolicy.verifyReceipt(update,count,hex(digest.digest()));verifyArchive(partial,update)
            if(target.exists())require(target.delete()){"Could not replace the previous update"}
            require(partial.renameTo(target)){"Could not save the verified update"};verified=target
            return JSONObject().put("ready",true).put("version",update.version)
        }finally{if(partial.exists())partial.delete()}
    }
    private fun verifyArchive(file:File,update:AppUpdate){
        val local=installed();val archive=activity.packageManager.getPackageArchiveInfo(file.absolutePath,packageFlags())?:error("Android could not verify this update package")
        UpdatePolicy.verifyPackage(archive.packageName,version(archive),signers(archive),signers(local),update,version(local))
        require((archive.applicationInfo?.minSdkVersion?:Int.MAX_VALUE)<=Build.VERSION.SDK_INT){"This update needs a newer Android version"}
    }
    @Synchronized fun install():JSONObject {
        val update=candidate?:error("Check for an update first");val file=verified?:error("Download the update first")
        require(file.isFile){"The update expired from the app cache. Download it again."};verifyArchive(file,update)
        if(!activity.packageManager.canRequestPackageInstalls()){
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${activity.packageName}")))
            return JSONObject().put("action","permission-required")
        }
        val uri=FileProvider.getUriForFile(activity,activity.packageName+".updates",file)
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).apply{clipData=ClipData.newRawUri("DeviceBridge update",uri)})
        return JSONObject().put("action","installer-open")
    }
}
