!include "nsDialogs.nsh"
!include "MUI2.nsh"
!include "getProcessInfo.nsh"
Var pid

; Keep the builder's normal close-running-app behavior, then preserve legacy
; in-bundle markup before its old uninstaller replaces the application files.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  SetShellVarContext current
  ${If} ${FileExists} "$INSTDIR\resources\app\markup\*.*"
  ${AndIfNot} ${FileExists} "$APPDATA\clear-skies-portal\legacy-markup\.complete"
    CreateDirectory "$APPDATA\clear-skies-portal\legacy-markup"
    ClearErrors
    CopyFiles /SILENT "$INSTDIR\resources\app\markup\*.*" "$APPDATA\clear-skies-portal\legacy-markup"
    ${If} ${Errors}
      MessageBox MB_ICONSTOP "Clear Skies could not preserve your saved markup. Installation has stopped; your existing app and data are unchanged."
      Abort
    ${EndIf}
    FileOpen $0 "$APPDATA\clear-skies-portal\legacy-markup\.complete" w
    FileClose $0
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Clear Skies"
  !define MUI_WELCOMEPAGE_TEXT "Your map. Your terrain engine.$\r$\n$\r$\nInstall Clear Skies and its terrain engine together. No Node.js, terminal commands or separate engine download needed.$\r$\n$\r$\nTailscale is optional. Use it later to reach your engine from your other desktops and mobile devices."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom ClearSkiesTailscale
!macroend

!ifndef BUILD_UNINSTALLER
!ifndef ONE_CLICK
Function ClearSkiesTailscale
  !insertmacro MUI_HEADER_TEXT "Your terrain, on your devices" "Tailscale is optional. Local terrain works immediately."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 36u "Tailscale creates an encrypted private network (a tailnet) between your devices. Install it on your engine computer and any desktop, tablet or phone you want to connect."
  Pop $0
  ${NSD_CreateLabel} 0 42u 100% 44u "Without an engine: public imagery, basemaps and national 3DEP where browser access is supported.$\r$\nWith an engine: raw 1 m DEM rendering where available, WA DNR elevation, resumable area downloads and shared server-side caches."
  Pop $0
  ${NSD_CreateLabel} 0 92u 100% 44u "Once sharing is configured, any device on your tailnet allowed by its access rules can use your personal engine link directly in Clear Skies, including mobile. Keep the engine computer awake and the app running. Tailscale itself does not improve source resolution."
  Pop $0
  ${NSD_CreateLink} 0 143u 48% 14u "Official Tailscale website"
  Pop $0
  ${NSD_OnClick} $0 ClearSkiesTailscaleWebsite
  ${NSD_CreateLink} 50% 143u 50% 14u "Download latest Windows installer"
  Pop $0
  ${NSD_OnClick} $0 ClearSkiesTailscaleDownload
  ${NSD_CreateLabel} 0 166u 100% 26u "The app's setup guide has the full comparison and manual sharing steps. Automatic Tailscale server setup and link generation are planned for the next app update."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function ClearSkiesTailscaleWebsite
  Pop $0
  ExecShell "open" "https://tailscale.com/"
FunctionEnd
Function ClearSkiesTailscaleDownload
  Pop $0
  ExecShell "open" "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
FunctionEnd
!endif
!endif

!macro customInstall
  CreateShortCut "$SMPROGRAMS\Clear Skies Setup and Tailscale.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--setup" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend
!macro customUnInstall
  Delete "$SMPROGRAMS\Clear Skies Setup and Tailscale.lnk"
!macroend
