; Drama Studio NSIS hooks (electron-builder includes build/installer.nsh).
;
; Registers the Drama Studio Companion native messaging host for the current
; user so Chrome and Edge can find it, and removes it on uninstall. The app
; re-points these keys at <userData>\companion on every start (see
; electron/companionLink/registration.cjs); this copy covers the time before
; the first launch.

!define DS_COMPANION_HOST "com.dramastudio.companion"

!macro customInstall
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${DS_COMPANION_HOST}" "" "$INSTDIR\resources\companion\${DS_COMPANION_HOST}.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${DS_COMPANION_HOST}" "" "$INSTDIR\resources\companion\${DS_COMPANION_HOST}.json"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${DS_COMPANION_HOST}"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\${DS_COMPANION_HOST}"
    DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\${DS_COMPANION_HOST}"
  ${endIf}
!macroend
