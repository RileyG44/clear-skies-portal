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
      MessageBox MB_ICONSTOP "ClearSkies could not preserve your saved markup. Installation has stopped; your existing app and data are unchanged."
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
  !define MUI_WELCOMEPAGE_TITLE "Install ClearSkies"
  !define MUI_WELCOMEPAGE_TEXT "ClearSkies and its terrain engine will be installed together.$\r$\n$\r$\nNo separate Node.js installation or terminal commands are needed. After installation, a welcome page lets you open the app immediately or learn about optional remote access with Tailscale."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  CreateShortCut "$SMPROGRAMS\ClearSkies Setup and Tailscale.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--setup" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend
!macro customUnInstall
  Delete "$SMPROGRAMS\ClearSkies Setup and Tailscale.lnk"
!macroend
