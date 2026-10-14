; DesignExtractor Personal assisted installer. Shared extraction/registry/upgrade
; machinery remains electron-builder 26.15.3 (MIT); see NOTICE.md.
!include UAC.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include multiUserUi.nsh

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎安装去水印下载助手"
!define MUI_WELCOMEPAGE_TEXT "版本 ${VERSION}$\r$\n$\r$\n解析设计稿链接，预览与下载图片、GIF 和多页设计稿。$\r$\n$\r$\n安装前请关闭正在运行的本应用。个人历史记录保存在各 Windows 账户自己的用户数据目录中，升级不会清空。$\r$\n$\r$\n建议仅为当前用户安装。"
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "我已阅读并接受以上使用说明（不改变 MIT 及第三方开源许可）"
!define MUI_LICENSEPAGE_BUTTON "下一步(&N) >"
!define MUI_FINISHPAGE_TITLE "去水印下载助手安装完成"
!define MUI_FINISHPAGE_TEXT "版本 ${VERSION} 已安装。$\r$\n$\r$\n个人数据与程序目录分开保存。卸载默认保留历史记录、上传文件及配置。"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动去水印下载助手"
!define MUI_UNWELCOMEPAGE_TITLE "卸载去水印下载助手"
!define MUI_UNWELCOMEPAGE_TEXT "本向导仅删除所选安装范围的程序文件和快捷方式。$\r$\n$\r$\n将保留个人历史记录、上传文件、日志和配置。不会访问其他 Windows 用户的个人目录。$\r$\n$\r$\n本版本不提供自动清空个人数据功能。"

!ifndef BUILD_UNINSTALLER
Var ScopeAll
Var ScopeCurrent
Var DirectoryEdit
Var DesktopCheck
Var MenuCheck
Var DesktopWanted
Var MenuWanted
Var DirectoryChosen
Var PersonalProbe
Var PersonalDialog
Var ScopePathLabel
Var FinalPathLabel
Var UpdatingDirectoryEdit
Var InstallerStatus
Var ScopeCommitted
Var ElevationOutcome
!include "${PROJECT_DIR}\desktop\installer\path-state.nsh"

!macro customInit
  StrCpy $DesktopWanted ${BST_UNCHECKED}
  StrCpy $MenuWanted ${BST_CHECKED}
  ReadRegStr $OriginalUserInstall HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $OriginalMachineInstall HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCpy $installScope "user"
  StrCpy $DirectorySource "auto"
  ${If} $OriginalUserInstall == ""
  ${AndIf} $OriginalMachineInstall != ""
    StrCpy $installScope "machine"
  ${EndIf}
  ${If} ${isForAllUsers}
    StrCpy $installScope "machine"
  ${EndIf}
  ${If} ${isForCurrentUser}
    StrCpy $installScope "user"
  ${EndIf}
  !insertmacro GetDParameter $CustomDirectory
  ${If} $CustomDirectory != ""
    StrCpy $DirectorySource "custom"
  ${EndIf}
  ${If} ${UAC_IsInnerInstance}
    ${IfNot} ${UAC_IsAdmin}
      SetErrorLevel 0x666666
      Quit
    ${EndIf}
    ; UAC relaunch does not carry ordinary NSIS variables. Import the user's
    ; explicit selection and custom-directory intent, not the admin's default.
    StrCpy $ElevatedUserInstall $OriginalUserInstall
    !insertmacro UAC_AsUser_GetGlobalVar $installScope
    !insertmacro UAC_AsUser_GetGlobalVar $DirectorySource
    !insertmacro UAC_AsUser_GetGlobalVar $DirectoryScope
    !insertmacro UAC_AsUser_GetGlobalVar $CustomDirectory
    !insertmacro UAC_AsUser_GetGlobalVar $OriginalUserInstall
    ${If} $installScope != "machine"
      SetErrorLevel 1638
      Quit
    ${EndIf}
  ${EndIf}
  StrCpy $ScopeCommitted $installScope
  Call ApplyInstallScope
  ${If} ${Silent}
    Call CheckScopeConflict
  ${EndIf}
!macroend

Function ApplyInstallScope
  ${If} $installScope == "machine"
    StrCpy $installMode "all"
    SetShellVarContext all
  ${Else}
    StrCpy $installMode "CurrentUser"
    SetShellVarContext current
  ${EndIf}
  Call ResolveScopeDirectory
FunctionEnd

Function CheckScopeConflict
  Call ClassifyScopeConflict
  ${If} $ScopeConflict != ""
    StrCpy $InstallerStatus "existing_install_conflict"
    DetailPrint "installer_status=$InstallerStatus"
    ${If} $installScope == "machine"
      StrCpy $0 "检测到已有仅当前用户安装的版本。为避免覆盖错误，请先备份个人数据，卸载原程序并保留个人数据，再重新运行安装器选择所有用户安装。$\r$\n$\r$\n也可以返回并继续按当前用户范围升级。"
    ${Else}
      StrCpy $0 "检测到此电脑已有所有用户安装的版本。请返回选择所有用户范围，使用原机器级目录升级。更改范围前请备份个人数据，由管理员卸载原程序并保留数据。"
    ${EndIf}
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$0$\r$\n$\r$\n点击“确定”返回安装范围；点击“取消”退出安装器。不会自动卸载旧版本。" IDCANCEL scopeConflictCancel
    ${EndIf}
    SetErrorLevel 1638
    ${If} ${Silent}
      Quit
    ${EndIf}
    Abort
  ${EndIf}
  Return
  scopeConflictCancel:
    SetErrorLevel 1638
    Quit
FunctionEnd

Function ScopePage
  ${If} ${UAC_IsInnerInstance}
    Call ApplyInstallScope
    Call CheckScopeConflict
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "安装范围" "选择仅为当前用户或此电脑的所有用户安装。"
  nsDialogs::Create 1018
  Pop $PersonalDialog
  ${NSD_CreateRadioButton} 0 15u 100% 24u "仅为当前用户安装（推荐，无需管理员权限）"
  Pop $ScopeCurrent
  ${NSD_CreateRadioButton} 0 50u 100% 24u "为此电脑的所有用户安装（需要管理员权限）"
  Pop $ScopeAll
  ${NSD_OnClick} $ScopeAll ScopeChanged
  ${NSD_OnClick} $ScopeCurrent ScopeChanged
  ${NSD_CreateLabel} 0 83u 100% 40u ""
  Pop $ScopePathLabel
  ${NSD_CreateLabel} 0 126u 100% 25u "各账户的数据独立保存。跨范围安装需先备份并卸载旧程序，保留个人数据。"
  Pop $0
  ${If} $installScope == "machine"
    ${NSD_Check} $ScopeAll
  ${Else}
    ${NSD_Check} $ScopeCurrent
  ${EndIf}
  Call ShowScopeDirectory
  nsDialogs::Show
FunctionEnd

Function ScopeChanged
  Pop $0
  ${NSD_GetState} $ScopeAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $installScope "machine"
  ${Else}
    StrCpy $installScope "user"
  ${EndIf}
  ; Also change shell context when returning from a machine-scoped directory
  ; page. Otherwise $LOCALAPPDATA could still resolve in the all-user context.
  Call ApplyInstallScope
  Call ShowScopeDirectory
FunctionEnd

Function ShowScopeDirectory
  Call ClassifyScopeConflict
  ${If} $ScopeConflict != ""
    ${NSD_SetText} $ScopePathLabel "检测到另一安装范围的旧版本。点击“下一步”查看处理说明；不会进入文件复制。"
  ${Else}
    StrCpy $PathInput $INSTDIR
    StrCpy $PathInputMode "manual"
    Call NormalizeDirectory
    ${If} $PathError == ""
      ${NSD_SetText} $ScopePathLabel "计划安装目录：$NormalizedPath"
    ${Else}
      ${NSD_SetText} $ScopePathLabel "自定义目录需要在下一页修正：$INSTDIR"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function EnsureMachineElevation
  StrCpy $ElevationOutcome "ready"
  ${If} $installScope == "machine"
    ${IfNot} ${UAC_IsAdmin}
      ShowWindow $HWNDPARENT ${SW_HIDE}
      !insertmacro UAC_RunElevated
      ${If} $0 == 0
      ${AndIf} $1 == 1
        SetErrorLevel $2
        Quit
      ${EndIf}
      ${If} $0 == 1223
        StrCpy $InstallerStatus "uac_cancelled"
        StrCpy $0 "您已取消管理员授权。未开始复制文件，也未登记安装。请重试或选择仅为当前用户安装。"
      ${Else}
        StrCpy $InstallerStatus "permission_denied"
        StrCpy $0 "未取得管理员权限。未开始复制文件，也未登记安装。请重试或选择仅为当前用户安装。"
      ${EndIf}
      StrCpy $ElevationOutcome "failed"
      DetailPrint "installer_status=$InstallerStatus"
      ShowWindow $HWNDPARENT ${SW_SHOW}
      BringToFront
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$0"
      ${EndIf}
      SetErrorLevel 1223
      ${If} ${Silent}
        Quit
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

Function ScopeLeave
  ${NSD_GetState} $ScopeAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $installScope "machine"
  ${Else}
    StrCpy $installScope "user"
  ${EndIf}
  Call CheckScopeConflict
  Call EnsureMachineElevation
  Call ApplyInstallScope
  StrCpy $ScopeCommitted $installScope
  StrCpy $InstallerStatus ""
  SetErrorLevel 0
FunctionEnd

Function DirectoryPage
  Call CheckScopeConflict
  ${If} $ScopeCommitted != $installScope
    StrCpy $InstallerStatus "scope_mismatch"
    DetailPrint "installer_status=$InstallerStatus"
    Abort
  ${EndIf}
  Call ApplyInstallScope
  Call EnsureMachineElevation
  !insertmacro MUI_HEADER_TEXT "选择安装目录" "仅保存程序文件；个人历史记录的位置不会随之改变。"
  nsDialogs::Create 1018
  Pop $PersonalDialog
  ${NSD_CreateLabel} 0 0 100% 28u "选择磁盘或上级文件夹后，安装器会自动创建 DesignExtractor Personal 文件夹。手动输入上级目录时，请以 \ 结尾。"
  Pop $0
  ${NSD_CreateText} 0 38u 100% 14u "$INSTDIR"
  Pop $DirectoryEdit
  ${NSD_OnChange} $DirectoryEdit DirectoryChanged
  ${NSD_CreateButton} 0 62u 90u 18u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 BrowseDirectory
  ${NSD_CreateButton} 100u 62u 100u 18u "恢复默认目录"
  Pop $0
  ${NSD_OnClick} $0 ResetDirectory
  SectionGetSize 0 $0
  IntOp $0 $0 / 1024
  ${NSD_CreateLabel} 0 87u 100% 30u ""
  Pop $FinalPathLabel
  ${NSD_CreateLabel} 0 124u 100% 27u "程序约需 $0 MB。下一步检查权限、空间及冲突。个人数据位置不受影响。"
  Pop $0
  Call ShowFinalDirectory
  nsDialogs::Show
FunctionEnd

Function DirectoryChanged
  Pop $0
  ${If} $UpdatingDirectoryEdit != "1"
    ${NSD_GetText} $DirectoryEdit $CustomDirectory
    StrCpy $DirectorySource "custom"
  ${EndIf}
  Call ShowFinalDirectory
FunctionEnd

Function ShowFinalDirectory
  ${NSD_GetText} $DirectoryEdit $PathInput
  StrCpy $PathInputMode "manual"
  Call NormalizeDirectory
  ${If} $PathError == ""
    ${NSD_SetText} $FinalPathLabel "最终安装目录：$NormalizedPath"
  ${ElseIf} $PathError == "network_path_rejected"
    ${NSD_SetText} $FinalPathLabel "不支持网络共享或网络盘。请选择本机磁盘上的专用目录。"
  ${Else}
    ${NSD_SetText} $FinalPathLabel "请输入有效本机路径，例如 E:\ 或 D:\Applications\。"
  ${EndIf}
FunctionEnd

Function BrowseDirectory
  Pop $0
  ${NSD_GetText} $DirectoryEdit $1
  nsDialogs::SelectFolderDialog "选择磁盘或上级文件夹（自动创建应用文件夹）" "$1"
  Pop $1
  ${If} $1 != error
    StrCpy $PathInput $1
    StrCpy $PathInputMode "browse"
    Call NormalizeDirectory
    Call RequireValidPath
    StrCpy $UpdatingDirectoryEdit "1"
    ${NSD_SetText} $DirectoryEdit "$NormalizedPath"
    StrCpy $UpdatingDirectoryEdit "0"
    StrCpy $DirectorySource "custom"
    StrCpy $CustomDirectory $NormalizedPath
    Call ShowFinalDirectory
  ${EndIf}
FunctionEnd

Function ResetDirectory
  Pop $0
  Call GetScopeDefaultDirectory
  StrCpy $UpdatingDirectoryEdit "1"
  ${NSD_SetText} $DirectoryEdit "$DefaultDirectory"
  StrCpy $UpdatingDirectoryEdit "0"
  StrCpy $DirectorySource "default"
  StrCpy $CustomDirectory ""
  Call ShowFinalDirectory
FunctionEnd

Function DirectoryLeave
  ${NSD_GetText} $DirectoryEdit $INSTDIR
  Call ValidateDirectory
  StrCpy $UpdatingDirectoryEdit "1"
  ${NSD_SetText} $DirectoryEdit "$INSTDIR"
  StrCpy $UpdatingDirectoryEdit "0"
  ${If} $DirectorySource == "custom"
    StrCpy $CustomDirectory $INSTDIR
  ${EndIf}
  StrCpy $DirectoryChosen $INSTDIR
FunctionEnd

Function RequireValidPath
  ${If} $PathError != ""
    StrCpy $InstallerStatus $PathError
    DetailPrint "installer_status=$InstallerStatus"
    ${If} $PathError == "network_path_rejected"
      MessageBox MB_OK|MB_ICONEXCLAMATION "不支持网络共享路径或网络盘。请选择本机磁盘，例如 E:\DesignExtractor Personal。" /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "路径无效或盘符不存在。请输入本机绝对路径，例如 E:\ 或 D:\Applications\DesignExtractor Personal。不会改到其他磁盘。" /SD IDOK
    ${EndIf}
    SetErrorLevel 87
    Abort
  ${EndIf}
FunctionEnd

Function ValidateDirectory
  Call CheckScopeConflict
  StrCpy $PathInput $INSTDIR
  StrCpy $PathInputMode "manual"
  Call NormalizeDirectory
  Call RequireValidPath
  StrCpy $INSTDIR $NormalizedPath
  StrCpy $InstallerStatus $PathStatus
  DetailPrint "installer_status=$InstallerStatus"
  ${If} $installScope == "machine"
    StrCpy $2 $OriginalMachineInstall
  ${Else}
    StrCpy $2 $OriginalUserInstall
  ${EndIf}
  ${If} $INSTDIR != $2
    FindFirst $0 $1 "$INSTDIR\*.*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        FindClose $0
        MessageBox MB_OK|MB_ICONEXCLAMATION "该目录已有文件。为避免影响其他文件，请选择新的空目录或本应用原安装目录。" /SD IDOK
        StrCpy $InstallerStatus "destination_not_empty"
        SetErrorLevel 87
        Abort
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
  System::Call 'kernel32::GetFileAttributes(t "$INSTDIR")i.r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "请选择普通专用目录，不支持符号链接或目录联接。" /SD IDOK
      StrCpy $InstallerStatus "invalid_path"
      SetErrorLevel 87
      Abort
    ${EndIf}
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  System::Call 'kernel32::GetTickCount()i.r0'
  StrCpy $PersonalProbe "$INSTDIR\.designextractor-write-$0.tmp"
  FileOpen $1 "$PersonalProbe" w
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法写入所选目录。请检查目录权限、磁盘状态，或选择其他位置。旧版程序与个人数据尚未删除。" /SD IDOK
    StrCpy $InstallerStatus "permission_denied"
    SetErrorLevel 5
    Abort
  ${EndIf}
  FileClose $1
  Delete "$PersonalProbe"
  ${DriveSpace} "$INSTDIR" "/D=F /S=K" $0
  SectionGetSize 0 $1
  IntOp $1 $1 + 65536
  ${If} $0 < $1
    MessageBox MB_OK|MB_ICONEXCLAMATION "所选磁盘可用空间不足。请释放空间或选择其他磁盘；旧版程序与个人数据尚未删除。" /SD IDOK
    StrCpy $InstallerStatus "insufficient_disk_space"
    SetErrorLevel 112
    Abort
  ${EndIf}
FunctionEnd

Function ShortcutPage
  !insertmacro MUI_HEADER_TEXT "快捷方式" "选择需要创建的快捷方式。"
  nsDialogs::Create 1018
  Pop $PersonalDialog
  ${NSD_CreateCheckbox} 0 20u 100% 22u "创建开始菜单快捷方式"
  Pop $MenuCheck
  ${NSD_SetState} $MenuCheck $MenuWanted
  ${NSD_CreateCheckbox} 0 55u 100% 22u "创建桌面快捷方式"
  Pop $DesktopCheck
  ${NSD_SetState} $DesktopCheck $DesktopWanted
  ${NSD_CreateLabel} 0 96u 100% 35u "快捷方式将写入所选安装范围。取消勾选会移除该范围内本应用的旧快捷方式。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ShortcutLeave
  ${NSD_GetState} $DesktopCheck $DesktopWanted
  ${NSD_GetState} $MenuCheck $MenuWanted
  Call ValidateDirectory
FunctionEnd

Function StartApp
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 missingRuntime
  IfFileExists "$INSTDIR\resources\chromium\chrome-win64\chrome.exe" 0 missingRuntime
  ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
  Return
  missingRuntime:
    MessageBox MB_OK|MB_ICONSTOP "程序或随包浏览器不完整，请重新运行安装程序修复。"
FunctionEnd

!macro customInstall
  ${If} $DesktopWanted != ${BST_CHECKED}
    Delete "$newDesktopLink"
  ${EndIf}
  ${If} $MenuWanted != ${BST_CHECKED}
    Delete "$newStartMenuLink"
  ${EndIf}
!macroend

!insertmacro MUI_PAGE_WELCOME
!insertmacro licensePage
Page custom ScopePage ScopeLeave
Page custom DirectoryPage DirectoryLeave
Page custom ShortcutPage ShortcutLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION StartApp
!insertmacro MUI_PAGE_FINISH
!define BUILD_UNINSTALLER
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro PAGE_INSTALL_MODE
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!undef BUILD_UNINSTALLER
!macro customUnInit
  ${If} ${isDeleteAppData}
    MessageBox MB_OK|MB_ICONEXCLAMATION "此版本不支持自动删除个人数据。请去掉 --delete-app-data 参数后重试卸载；个人数据将保留。" /SD IDOK
    SetErrorLevel 87
    Quit
  ${EndIf}
!macroend
!endif

; initMultiUser is appended verbatim from electron-builder 26.15.3.
!macro initMultiUser
  !ifdef INSTALL_MODE_PER_ALL_USERS
    !insertmacro setInstallModePerAllUsers
  !else
    ${If} ${UAC_IsInnerInstance}
    ${AndIfNot} ${UAC_IsAdmin}
      # special return value for outer instance so it knows we did not have admin rights
      SetErrorLevel 0x666666
      Quit
    ${endIf}

    !ifndef MULTIUSER_INIT_TEXT_ADMINREQUIRED
      !define MULTIUSER_INIT_TEXT_ADMINREQUIRED "$(^Caption) requires administrator privileges."
    !endif

    !ifndef MULTIUSER_INIT_TEXT_POWERREQUIRED
      !define MULTIUSER_INIT_TEXT_POWERREQUIRED "$(^Caption) requires at least Power User privileges."
    !endif

    !ifndef MULTIUSER_INIT_TEXT_ALLUSERSNOTPOSSIBLE
      !define MULTIUSER_INIT_TEXT_ALLUSERSNOTPOSSIBLE "Your user account does not have sufficient privileges to install $(^Name) for all users of this computer."
    !endif

    # checks registry for previous installation path (both for upgrading, reinstall, or uninstall)
    StrCpy $hasPerMachineInstallation "0"
    StrCpy $hasPerUserInstallation "0"

    # set installation mode to setting from a previous installation
    ReadRegStr $perMachineInstallationFolder HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perMachineInstallationFolder != ""
      StrCpy $hasPerMachineInstallation "1"
    ${endif}

    ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $perUserInstallationFolder != ""
      StrCpy $hasPerUserInstallation "1"
    ${endif}

    ${GetParameters} $R0
    ${GetOptions} $R0 "/allusers" $R1
    ${IfNot} ${Errors}
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
    ${EndIf}

    ${GetOptions} $R0 "/currentuser" $R1
    ${IfNot} ${Errors}
      StrCpy $hasPerMachineInstallation "0"
      StrCpy $hasPerUserInstallation "1"
    ${EndIf}

    ${if} $hasPerUserInstallation == "1"
    ${andif} $hasPerMachineInstallation == "0"
      !insertmacro setInstallModePerUser
    ${elseif} $hasPerUserInstallation == "0"
      ${andif} $hasPerMachineInstallation == "1"
      !insertmacro setInstallModePerAllUsers
    ${else}
      # if there is no installation, or there is both per-user and per-machine
      !ifdef INSTALL_MODE_PER_ALL_USERS
        !insertmacro setInstallModePerAllUsers
      !else
        !ifdef INSTALL_MODE_PER_ALL_USERS_DEFAULT
          !insertmacro setInstallModePerAllUsers
        !else
          !insertmacro setInstallModePerUser
        !endif
      !endif
    ${endif}
  !endif
!macroend
