Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strPath = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath

args = ""
For Each arg In WScript.Arguments
    args = args & " " & arg
Next

exePath = strPath & "\SaveSync.exe"
If FSO.FileExists(exePath) Then
    WshShell.Run """" & exePath & """" & args, 0, False
Else
    WshShell.Run "node """ & strPath & "\server\index.js""" & args, 0, False
End If
