#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AppExe
  #error AppExe is required
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

[Icons]
Name: "{autoprograms}\DeviceBridge"; Filename: "{app}\DeviceBridge.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\DeviceBridge"; Filename: "{app}\DeviceBridge.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\DeviceBridge.exe"; Description: "Open DeviceBridge"; Flags: nowait postinstall skipifsilent
