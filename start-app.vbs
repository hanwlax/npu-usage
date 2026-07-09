'use strict'
' Double-click to start NPU Monitor desktop app (no terminal window).
Set oShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = strPath
oShell.Run "cmd.exe /c node launch-app.js", 0, False
Set oShell = Nothing
