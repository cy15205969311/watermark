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
Var OriginalUserInstall
Var OriginalMachineInstall

!macro customInit
  StrCpy $DesktopWanted ${BST_UNCHECKED}
  StrCpy $MenuWanted ${BST_CHECKED}
  ReadRegStr $OriginalUserInstall HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $OriginalMachineInstall HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  Call CheckScopeConflict
!macroend

Function CheckScopeConflict
  ${If} $installMode == "all"
  ${AndIf} $OriginalUserInstall != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到当前用户已安装本应用：$\r$\n$OriginalUserInstall$\r$\n$\r$\n请使用当前用户范围升级；如需改为所有用户安装，请先备份个人数据并卸载原程序（卸载保留数据），再重新安装。不会自动卸载旧版本。" /SD IDOK
    SetErrorLevel 1638
    ${If} ${Silent}
      Quit
    ${EndIf}
    Abort
  ${EndIf}
  ${If} $installMode == "CurrentUser"
  ${AndIf} $OriginalMachineInstall != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到此电脑已为所有用户安装本应用：$\r$\n$OriginalMachineInstall$\r$\n$\r$\n请选择所有用户范围升级。更改范围前请由管理员卸载原程序（保留个人数据）。不会自动删除旧版本。" /SD IDOK
    SetErrorLevel 1638
    ${If} ${Silent}
      Quit
    ${EndIf}
    Abort
  ${EndIf}
FunctionEnd

Function ScopePage
  ${If} ${UAC_IsInnerInstance}
    !insertmacro setInstallModePerAllUsers
    Call CheckScopeConflict
    Abort
  ${EndIf}
  ${If} ${isForAllUsers}
    StrCpy $installMode "all"
    Call CheckScopeConflict
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "安装范围" "选择仅为当前用户或此电脑的所有用户安装。"
  nsDialogs::Create 1018
  Pop $PersonalDialog
  ${NSD_CreateRadioButton} 0 15u 100% 24u "仅为当前用户安装（推荐，无需管理员权限）"
  Pop $ScopeCurrent
  ${NSD_CreateRadioButton} 0 50u 100% 24u "为此电脑的所有用户安装（需要管理员权限）"
  Pop $ScopeAll
  ${NSD_CreateLabel} 0 92u 100% 45u "各 Windows 账户仍使用自己的个人历史记录和上传文件。已有安装请保持原安装范围；更改范围需先备份并卸载原程序。"
  Pop $0
  ${If} $installMode == "all"
    ${NSD_Check} $ScopeAll
  ${Else}
    ${NSD_Check} $ScopeCurrent
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ScopeLeave
  ${NSD_GetState} $ScopeAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $installMode "all"
    Call CheckScopeConflict
    ${IfNot} ${UAC_IsAdmin}
      ShowWindow $HWNDPARENT ${SW_HIDE}
      !insertmacro UAC_RunElevated
      ${If} $0 == 0
      ${AndIf} $1 == 1
        SetErrorLevel $2
        Quit
      ${EndIf}
      ShowWindow $HWNDPARENT ${SW_SHOW}
      BringToFront
      MessageBox MB_OK|MB_ICONEXCLAMATION "未取得管理员权限，未开始安装。您可以重试或选择仅为当前用户安装。"
      Abort
    ${EndIf}
    !insertmacro setInstallModePerAllUsers
  ${Else}
    StrCpy $installMode "CurrentUser"
    Call CheckScopeConflict
    !insertmacro setInstallModePerUser
  ${EndIf}
FunctionEnd

Function DirectoryPage
  !insertmacro MUI_HEADER_TEXT "选择安装目录" "仅保存程序文件；个人历史记录的位置不会随之改变。"
  nsDialogs::Create 1018
  Pop $PersonalDialog
  ${NSD_CreateLabel} 0 0 100% 28u "请选择专用于本应用的目录。支持中文和空格；升级可保留原位置或选择新的空目录。"
  Pop $0
  ${NSD_CreateText} 0 38u 100% 14u "$INSTDIR"
  Pop $DirectoryEdit
  ${NSD_CreateButton} 0 62u 90u 18u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 BrowseDirectory
  ${NSD_CreateButton} 100u 62u 100u 18u "恢复默认目录"
  Pop $0
  ${NSD_OnClick} $0 ResetDirectory
  SectionGetSize ${INSTALL_SECTION_ID} $0
  IntOp $0 $0 / 1024
  ${NSD_CreateLabel} 0 96u 100% 40u "程序约需 $0 MB 空间。安装前将检查可写权限与可用空间。$\r$\n卸载仅保留个人数据，请勿在程序目录保存其他文件。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function BrowseDirectory
  Pop $0
  ${NSD_GetText} $DirectoryEdit $1
  nsDialogs::SelectFolderDialog "选择本应用专属安装目录" "$1"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $DirectoryEdit "$1"
  ${EndIf}
FunctionEnd

Function ResetDirectory
  Pop $0
  ${If} $installMode == "all"
    StrCpy $1 "$PROGRAMFILES64\DesignExtractor Personal"
  ${Else}
    StrCpy $1 "$LOCALAPPDATA\Programs\DesignExtractor Personal"
  ${EndIf}
  ${NSD_SetText} $DirectoryEdit "$1"
FunctionEnd

Function DirectoryLeave
  ${NSD_GetText} $DirectoryEdit $INSTDIR
  Call ValidateDirectory
  StrCpy $DirectoryChosen $INSTDIR
FunctionEnd

Function ValidateDirectory
  ; Reject roots, relative paths, and non-dedicated existing directories. This
  ; also prevents the vendor recursive uninstaller from targeting user data.
  StrCpy $0 $INSTDIR 2 1
  StrLen $1 $INSTDIR
  ${If} $0 != ":\"
  ${OrIf} $1 < 4
    MessageBox MB_OK|MB_ICONEXCLAMATION "请输入本机磁盘上的完整专用目录，例如 D:\Applications\DesignExtractor Personal。不能选择磁盘根目录或网络路径。" /SD IDOK
    Abort
  ${EndIf}
  GetFullPathName $INSTDIR $INSTDIR
  StrCpy $1 $INSTDIR 1 -1
  ${If} $1 == "\"
    StrCpy $INSTDIR $INSTDIR -1
  ${EndIf}
  StrLen $1 $INSTDIR
  ${If} $1 < 4
    Abort
  ${EndIf}
  ReadRegStr $2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $INSTDIR != $2
    FindFirst $0 $1 "$INSTDIR\*.*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        FindClose $0
        MessageBox MB_OK|MB_ICONEXCLAMATION "该目录已有文件。为避免影响其他文件，请选择新的空目录或本应用原安装目录。" /SD IDOK
        Abort
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  System::Call 'kernel32::GetTickCount()i.r0'
  StrCpy $PersonalProbe "$INSTDIR\.designextractor-write-$0.tmp"
  FileOpen $1 "$PersonalProbe" w
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法写入所选目录。请检查目录权限、磁盘状态，或选择其他位置。旧版程序与个人数据尚未删除。" /SD IDOK
    Abort
  ${EndIf}
  FileClose $1
  Delete "$PersonalProbe"
  ${DriveSpace} "$INSTDIR" "/D=F /S=K" $0
  SectionGetSize ${INSTALL_SECTION_ID} $1
  IntOp $1 $1 + 65536
  ${If} $0 < $1
    MessageBox MB_OK|MB_ICONEXCLAMATION "所选磁盘可用空间不足。请释放空间或选择其他磁盘；旧版程序与个人数据尚未删除。" /SD IDOK
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
!else
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro PAGE_INSTALL_MODE
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
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
