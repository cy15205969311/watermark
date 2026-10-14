; Shared by the production wizard and a compiled NSIS no-install test harness.
!include LogicLib.nsh
!include FileFunc.nsh
!define PERSONAL_FOLDER "DesignExtractor Personal"
Var installScope
Var DirectorySource
Var DirectoryScope
Var CustomDirectory
Var OriginalUserInstall
Var OriginalMachineInstall
Var ElevatedUserInstall
Var DefaultDirectory
Var ScopeConflict
Var PathInput
Var PathInputMode
Var NormalizedPath
Var PathError
Var PathStatus
Var PathAppend
Var PathSegment

Function GetScopeDefaultDirectory
  ${If} $installScope == "machine"
    StrCpy $DefaultDirectory "$PROGRAMFILES64\${PERSONAL_FOLDER}"
  ${Else}
    StrCpy $DefaultDirectory "$LOCALAPPDATA\Programs\${PERSONAL_FOLDER}"
  ${EndIf}
FunctionEnd

Function ResolveScopeDirectory
  Call GetScopeDefaultDirectory
  ${If} $DirectoryScope != $installScope
  ${AndIf} $DirectorySource != "custom"
    StrCpy $DirectorySource "auto"
  ${EndIf}
  StrCpy $DirectoryScope $installScope
  ${If} $DirectorySource == "custom"
    StrCpy $INSTDIR $CustomDirectory
    Return
  ${EndIf}
  ${If} $DirectorySource == "default"
    StrCpy $INSTDIR $DefaultDirectory
    Return
  ${EndIf}
  ${If} $installScope == "machine"
    StrCpy $INSTDIR $OriginalMachineInstall
  ${Else}
    StrCpy $INSTDIR $OriginalUserInstall
  ${EndIf}
  ${If} $INSTDIR == ""
    StrCpy $INSTDIR $DefaultDirectory
    StrCpy $DirectorySource "default"
  ${Else}
    StrCpy $DirectorySource "registered"
  ${EndIf}
FunctionEnd

Function ClassifyScopeConflict
  StrCpy $ScopeConflict ""
  ${If} $installScope == "machine"
    ${If} $OriginalUserInstall != ""
    ${OrIf} $ElevatedUserInstall != ""
      StrCpy $ScopeConflict "existing_install_conflict"
    ${EndIf}
  ${ElseIf} $OriginalMachineInstall != ""
    StrCpy $ScopeConflict "existing_install_conflict"
  ${EndIf}
FunctionEnd

Function NormalizeDirectory
  ; No file creation or registry writes. Manual trailing '\' explicitly
  ; identifies a parent; browsing always chooses a parent unless its basename
  ; is already the product folder. A custom final basename stays unchanged.
  StrCpy $PathError ""
  StrCpy $PathStatus "unchanged"
  StrCpy $NormalizedPath $PathInput
  StrCpy $PathAppend "0"
  StrCpy $0 $PathInput 2
  ${If} $0 == "\\"
    StrCpy $PathError "network_path_rejected"
    Return
  ${EndIf}
  StrCpy $0 $PathInput 2 1
  ${If} $0 != ":\"
    StrCpy $PathError "invalid_path"
    Return
  ${EndIf}
  StrCpy $1 $PathInput 3
  System::Call 'kernel32::GetDriveType(t r1)i.r0'
  ${If} $0 == 0
  ${OrIf} $0 == 1
    StrCpy $PathError "invalid_path"
    Return
  ${ElseIf} $0 == 4
    StrCpy $PathError "network_path_rejected"
    Return
  ${EndIf}
  StrCpy $0 $PathInput 1 -1
  ${If} $0 == "\"
    StrCpy $PathAppend "1"
  ${EndIf}
  ${If} $PathInputMode == "browse"
    StrCpy $PathAppend "1"
  ${EndIf}
  ; Reject invalid characters, reserved names and dot segments rather than
  ; silently redirecting Windows-normalized names to a different destination.
  StrCpy $PathSegment ""
  StrCpy $1 3
  pathCharacterLoop:
    StrCpy $0 $PathInput 1 $1
    ${If} $0 == ""
    ${OrIf} $0 == "\"
      Call CheckPathSegment
      ${If} $PathError != ""
        Return
      ${EndIf}
      StrCpy $PathSegment ""
      ${If} $0 == ""
        Goto pathCharactersDone
      ${EndIf}
    ${Else}
      ${If} $0 == ":"
      ${OrIf} $0 == "/"
      ${OrIf} $0 == "*"
      ${OrIf} $0 == "?"
      ${OrIf} $0 == '$\"'
      ${OrIf} $0 == "<"
      ${OrIf} $0 == ">"
      ${OrIf} $0 == "|"
      ${OrIf} $0 == "$\r"
      ${OrIf} $0 == "$\n"
      ${OrIf} $0 == "$\t"
        StrCpy $PathError "invalid_path"
        Return
      ${EndIf}
      StrCpy $PathSegment "$PathSegment$0"
    ${EndIf}
    IntOp $1 $1 + 1
    Goto pathCharacterLoop
  pathCharactersDone:
  ; Already absolute, with dot/device segments rejected. GetFullPathName in
  ; NSIS can fail for a nonexistent final component, which is normal on first
  ; installation. Preserve the validated destination without a disk lookup.
  StrCpy $NormalizedPath $PathInput
  StrLen $0 $NormalizedPath
  ${If} $0 == 3
    StrCpy $NormalizedPath "$NormalizedPath${PERSONAL_FOLDER}"
    StrCpy $PathStatus "root_path_normalized"
    Return
  ${EndIf}
  trimTrailingSeparator:
    StrCpy $0 $NormalizedPath 1 -1
    ${If} $0 == "\"
      StrCpy $NormalizedPath $NormalizedPath -1
      Goto trimTrailingSeparator
    ${EndIf}
  ${GetFileName} "$NormalizedPath" $0
  ; NSIS StrCmp (unlike StrCmpS) compares case-insensitively.
  StrCmp $0 "${PERSONAL_FOLDER}" normalizationDone
  ${If} $PathAppend == "1"
    StrCpy $NormalizedPath "$NormalizedPath\${PERSONAL_FOLDER}"
    StrCpy $PathStatus "parent_path_normalized"
  ${EndIf}
  normalizationDone:
FunctionEnd

Function CheckPathSegment
  Push $0
  Push $2
  ${If} $PathSegment != ""
    StrCpy $2 $PathSegment 1 -1
    ${If} $2 == "."
    ${OrIf} $2 == " "
      StrCpy $PathError "invalid_path"
    ${EndIf}
    ; A device name is reserved even when followed by an extension.
    StrCpy $2 0
    pathDeviceLoop:
      StrCpy $0 $PathSegment 1 $2
      ${If} $0 == "."
      ${OrIf} $0 == ""
        StrCpy $2 $PathSegment $2
        Goto checkDeviceName
      ${EndIf}
      IntOp $2 $2 + 1
      Goto pathDeviceLoop
    checkDeviceName:
    ${If} $2 == "CON"
    ${OrIf} $2 == "PRN"
    ${OrIf} $2 == "AUX"
    ${OrIf} $2 == "NUL"
      StrCpy $PathError "invalid_path"
    ${EndIf}
    StrLen $0 $2
    ${If} $0 == 4
      StrCpy $0 $2 3
      ${If} $0 == "COM"
      ${OrIf} $0 == "LPT"
        StrCpy $0 $2 1 -1
        ${If} $0 >= 1
        ${AndIf} $0 <= 9
          StrCpy $PathError "invalid_path"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $0
FunctionEnd
