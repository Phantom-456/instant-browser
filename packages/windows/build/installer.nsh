; Registers Instant Browser as a web browser for this user, so it is listed in Settings, Apps, Default apps.
; electron-builder includes this file (nsis.include in electron-builder.yml). Names are in src/shared/winRegistration.ts;
; tests/unit/winRegistration.test.ts checks that the two match. Windows never lets an app make itself the default:
; the user chooses it in Default apps.

!macro customInstall
  ; The link handler: Windows runs the app with the address.
  WriteRegStr HKCU "Software\Classes\InstantBrowserURL" "" "Instant Browser URL"
  WriteRegStr HKCU "Software\Classes\InstantBrowserURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\InstantBrowserURL\DefaultIcon" "" "$appExe,0"
  ; --single-argument: Chromium takes everything after it as one argument, so an address with a quote in it cannot
  ; add switches of its own (the CVE-2018-1000006 pattern). Chrome and Edge register the same way.
  WriteRegStr HKCU "Software\Classes\InstantBrowserURL\shell\open\command" "" '"$appExe" --single-argument %1'

  ; The browser entry and what it can open.
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser" "" "Instant Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\DefaultIcon" "" "$appExe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\shell\open\command" "" '"$appExe"'
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities" "ApplicationName" "Instant Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities" "ApplicationDescription" "Small floating one-tab browser windows from a hotkey."
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities\StartMenu" "StartMenuInternet" "Instant Browser"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities\URLAssociations" "http" "InstantBrowserURL"
  WriteRegStr HKCU "Software\Clients\StartMenuInternet\Instant Browser\Capabilities\URLAssociations" "https" "InstantBrowserURL"
  WriteRegStr HKCU "Software\RegisteredApplications" "Instant Browser" "Software\Clients\StartMenuInternet\Instant Browser\Capabilities"

  ; Tell Explorer that associations changed (SHCNE_ASSOCCHANGED).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Instant Browser"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\Instant Browser"
  DeleteRegKey HKCU "Software\Classes\InstantBrowserURL"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
