param([Parameter(Mandatory=$true)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
try {
  $install = [System.IO.Path]::GetFullPath($InstallDirectory)
  $personal = [System.IO.Path]::Combine($install, 'personal')
  $users = [System.IO.Path]::Combine($personal, 'users')
  # Never follow a directory junction while granting permissions.
  foreach ($target in @($personal, $users)) {
    $item = $target
    while ($item) {
      if ([System.IO.Directory]::Exists($item) -and (([System.IO.File]::GetAttributes($item) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Reparse path rejected' }
      $parent = [System.IO.Path]::GetDirectoryName($item)
      if ($parent -eq $item) { break }
      $item = $parent
    }
    [void][System.IO.Directory]::CreateDirectory($target)
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($id in @('S-1-5-18', 'S-1-5-32-544')) {
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($id), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      [void]$acl.AddAccessRule($rule)
    }
    $rights = if ($target -eq $users) { 'ReadAndExecute,CreateDirectories' } else { 'ReadAndExecute' }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), $rights, 'None', 'None', 'Allow')
    [void]$acl.AddAccessRule($rule)
    # Replace this container's DACL only; do not recursively grant program or
    # SID child permissions. Each SID directory is secured by its owner.
    [System.IO.Directory]::SetAccessControl($target, $acl)
  }
  exit 0
} catch {
  [Console]::Error.WriteLine('personal storage permission setup failed')
  exit 5
}
