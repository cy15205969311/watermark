; Only the application-owned install tree is visited. Downloads is never moved,
; traversed or deleted. A nonempty root is deliberately retained on uninstall.
Function un.RemoveProgramFilesKeepingDownloads
  Push $R0
  Push $R1
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  keepDownloadsLoop:
    StrCmp $R1 "" keepDownloadsDone
    StrCmp $R1 "." keepDownloadsNext
    StrCmp $R1 ".." keepDownloadsNext
    StrCmp $R1 "Downloads" keepDownloadsNext
    StrCmp $R1 "personal" keepDownloadsNext
    StrCmp $R1 "storage-layout.ini" keepDownloadsNext
    IfFileExists "$INSTDIR\$R1\*.*" 0 +3
      RMDir /r "$INSTDIR\$R1"
      Goto keepDownloadsNext
    Delete "$INSTDIR\$R1"
  keepDownloadsNext:
    FindNext $R0 $R1
    Goto keepDownloadsLoop
  keepDownloadsDone:
    FindClose $R0
    RMDir "$INSTDIR"
    Pop $R1
    Pop $R0
FunctionEnd
