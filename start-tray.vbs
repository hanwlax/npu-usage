'use strict';
' Double-click to start NPU Monitor tray (no terminal window).
Set oShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = strPath
oShell.Run "cmd.exe /c node launch-tray.js", 0, False
Set oShell = Nothing
