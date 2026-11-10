#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AppExe
  #error AppExe is required
#endif
#ifndef WebViewRuntime
  #error The verified offline WebView2 runtime is required
#endif

[Setup]
AppId={{7344E2DF-3B58-4B13-8C38-A4131B2594B2}
AppName=DeviceBridge
AppVersion={#AppVersion}
AppVerName=DeviceBridge {#AppVersion}
AppPublisher=Satish01-oss
AppPublisherURL=https://github.com/Satish01-oss/Drive-Bridge
AppSupportURL=https://github.com/Satish01-oss/Drive-Bridge/issues
DefaultDirName={localappdata}\Programs\DeviceBridge
DefaultGroupName=DeviceBridge
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputPath}
OutputBaseFilename=DeviceBridge-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\DeviceBridge.ico
UninstallDisplayName=DeviceBridge
UninstallDisplayIcon={app}\DeviceBridge.exe
AppMutex=Local\DeviceBridge.Desktop.v1
CloseApplications=no
RestartApplications=no
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription=DeviceBridge Windows Installer
VersionInfoProductName=DeviceBridge

[Tasks]
Name: "desktopicon"; Description: "Add DeviceBridge to my desktop"; Flags: checkedonce

[Files]
Source: "{#AppExe}"; DestDir: "{app}"; DestName: "DeviceBridge.exe"; Flags: ignoreversion
Source: "{#WebViewRuntime}"; DestName: "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Flags: dontcopy nocompression

[Icons]
Name: "{autoprograms}\DeviceBridge"; Filename: "{app}\DeviceBridge.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\DeviceBridge"; Filename: "{app}\DeviceBridge.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\DeviceBridge.exe"; Description: "Open DeviceBridge"; Flags: nowait postinstall skipifsilent

[Code]
function WebViewInstalled: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
  if not Result then
    Result := (RegQueryStringValue(HKCU32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if WebViewInstalled then exit;
  WizardForm.StatusLabel.Caption := 'Preparing the built-in Windows app runtime...';
  ExtractTemporaryFile('MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'The built-in Windows app runtime could not start. Please try setup again.'
  else if not WebViewInstalled then
    Result := 'The Windows app runtime could not finish installing (code ' + IntToStr(ExitCode) + '). Restart Windows, then run this same installer again.';
end;
