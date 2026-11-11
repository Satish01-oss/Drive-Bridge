package app.devicebridge.remote
import org.junit.Assert.*
import org.junit.Test
class MicrophonePermissionFlowTest {
    @Test fun permissionDialogDoesNotCancelItsOwnRequest(){val flow=MicrophonePermissionFlow();flow.begin();assertFalse(flow.shouldPauseOnActivityPause());flow.resumed();assertTrue(flow.complete(true));assertTrue(flow.shouldPauseOnActivityPause())}
    @Test fun backgroundingStillStopsPendingAccess(){val flow=MicrophonePermissionFlow();flow.begin();flow.stopped();assertFalse(flow.complete(true));assertTrue(flow.shouldPauseOnActivityPause())}
    @Test fun deniedPermissionDoesNotStartCapture(){val flow=MicrophonePermissionFlow();flow.begin();assertFalse(flow.complete(false));assertFalse(flow.awaitingSystemPermission)}
    @Test fun canceledPromptCannotGrantLatePermission(){val flow=MicrophonePermissionFlow();flow.begin();flow.cancel();assertFalse(flow.complete(true))}
    @Test fun foregroundReturnNeedsAnExplicitNewRequest(){val flow=MicrophonePermissionFlow();flow.begin();flow.stopped();flow.resumed();assertFalse(flow.complete(true));flow.begin();assertTrue(flow.complete(true))}
}
