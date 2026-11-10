package app.devicebridge.remote

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.*
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity: Activity() {
    private lateinit var web: WebView
    private lateinit var storage: ProtectedStore
    private val worker=Executors.newSingleThreadExecutor()
    private val updateWorker=Executors.newSingleThreadExecutor()
    private lateinit var updater:AppUpdater
    private var microphoneRequest: PermissionRequest?=null
    private val origin="https://appassets.androidplatform.net"
    override fun onCreate(state: Bundle?) {
        super.onCreate(state);storage=ProtectedStore(this);updater=AppUpdater(this);web=WebView(this)
        val root=FrameLayout(this);root.setBackgroundColor(Color.rgb(245,247,239));root.addView(web);setContentView(root)
        if(Build.VERSION.SDK_INT>=30){window.setDecorFitsSystemWindows(false);root.setOnApplyWindowInsetsListener{view,insets->val safe=insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime());view.setPadding(safe.left,safe.top,safe.right,safe.bottom);insets}}
        web.setBackgroundColor(Color.rgb(245,247,239));web.settings.apply{javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;mediaPlaybackRequiresUserGesture=false;safeBrowsingEnabled=true}
        WebView.setWebContentsDebuggingEnabled(false)
        val loader=WebViewAssetLoader.Builder().addPathHandler("/assets/",WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient=object:WebViewClient(){
            override fun shouldInterceptRequest(view: WebView,request:WebResourceRequest)=loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=request.url.scheme!="https"||request.url.host!="appassets.androidplatform.net"||!request.url.path.orEmpty().startsWith("/assets/")
        }
        web.webChromeClient=object:WebChromeClient(){override fun onPermissionRequest(request:PermissionRequest){runOnUiThread{
            if(request.origin.toString().trimEnd('/')!=origin||request.resources.any{it!=PermissionRequest.RESOURCE_AUDIO_CAPTURE}){request.deny();return@runOnUiThread}
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            else{microphoneRequest?.deny();microphoneRequest=request;requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),41)}
        }};override fun onPermissionRequestCanceled(request:PermissionRequest){if(microphoneRequest===request)microphoneRequest=null}}
        web.addJavascriptInterface(Bridge(),"DeviceBridgeAndroid");web.loadUrl("$origin/assets/index.html")
    }
    inner class Bridge {
        @JavascriptInterface fun postMessage(text:String){if(text.length>3*1024*1024)return;val updateCall=try{JSONObject(text).optString("type").startsWith("app.update.")}catch(_:Exception){return};(if(updateCall)updateWorker else worker).execute{
            var rpcId:String?=null
            try{val request=JSONObject(text);rpcId=request.optString("rpcId").takeIf{it.isNotEmpty()};val result:Any?=when(request.getString("type")){
                "identity.get"->JSONObject().put("publicKey",storage.publicKey())
                "identity.sign"->storage.sign(request.getString("purpose"),request.get("value"))
                "identity.verify"->storage.verify(request.getString("publicKey"),request.getString("purpose"),request.get("value"),request.getString("signature"))
                "store.get"->storage.get(request.getString("key"))
                "store.set"->{storage.set(request.getString("key"),request.get("value"));JSONObject.NULL}
                "app.update.check"->updater.check()
                "app.update.download"->updater.prepare()
                "app.update.install"->{val result=java.util.concurrent.CompletableFuture<JSONObject>();runOnUiThread{try{check(!isFinishing&&!isDestroyed){"Reopen DeviceBridge to install the update"};result.complete(updater.install())}catch(error:Exception){result.completeExceptionally(error)}};result.get(15,java.util.concurrent.TimeUnit.SECONDS)}
                else->throw IllegalArgumentException("This Android app controls the PC; it does not host a desktop.")
            };reply(JSONObject().put("rpcId",rpcId).put("result",result?:JSONObject.NULL))}
            catch(error:Exception){val cause=error.cause?:error;val message=if(updateCall&&(cause is java.net.UnknownHostException||cause is java.net.SocketTimeoutException))"Check your internet connection and try the update again." else cause.message?:"The app could not finish this action. Please try again.";reply(JSONObject().put("rpcId",rpcId).put("error",message))}
        }}
    }
    private fun reply(value:JSONObject){runOnUiThread{if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('devicebridge-native',{detail:"+value.toString()+"}));",null)}}
    override fun onRequestPermissionsResult(code:Int,permissions:Array<out String>,results:IntArray){super.onRequestPermissionsResult(code,permissions,results);if(code==41){val request=microphoneRequest;microphoneRequest=null;if(results.firstOrNull()==PackageManager.PERMISSION_GRANTED)request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))else request?.deny()}}
    override fun onPause(){super.onPause();microphoneRequest?.deny();microphoneRequest=null;web.evaluateJavascript("window.dispatchEvent(new Event('devicebridge-pause')); "){web.onPause()}}
    override fun onResume(){super.onResume();if(::web.isInitialized){web.onResume();web.evaluateJavascript("window.dispatchEvent(new Event('devicebridge-resume'));",null)}}
    override fun onDestroy(){microphoneRequest?.deny();web.removeJavascriptInterface("DeviceBridgeAndroid");web.destroy();worker.shutdownNow();updateWorker.shutdownNow();super.onDestroy()}
}
