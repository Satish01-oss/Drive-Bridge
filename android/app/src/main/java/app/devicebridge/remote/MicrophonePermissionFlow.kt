package app.devicebridge.remote

internal class MicrophonePermissionFlow {
    var awaitingSystemPermission=false
        private set
    var backgrounded=false
        private set
    fun begin(){awaitingSystemPermission=true}
    fun cancel(){awaitingSystemPermission=false}
    fun resumed(){backgrounded=false}
    fun stopped(){backgrounded=true;awaitingSystemPermission=false}
    fun shouldPauseOnActivityPause()=!awaitingSystemPermission
    fun complete(granted:Boolean):Boolean {val allowed=awaitingSystemPermission&&granted&&!backgrounded;awaitingSystemPermission=false;return allowed}
}
