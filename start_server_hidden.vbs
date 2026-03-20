Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & "C:\Program Files\nodejs\node.exe" & Chr(34) & " server.js", 0, False
Set shell = Nothing
