$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("D:\code\ClaudeLauncher\Claude Launcher Setup.lnk")
$sc.TargetPath = "D:\code\ClaudeLauncher\src-tauri\target\release\bundle\nsis\Claude Launcher_0.1.0_x64-setup.exe"
$sc.WorkingDirectory = "D:\code\ClaudeLauncher\src-tauri\target\release\bundle\nsis"
$sc.Description = "Claude Launcher NSIS Installer"
$sc.Save()
Write-Host "Shortcut created successfully"
