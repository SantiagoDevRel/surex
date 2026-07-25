@echo off
REM Windows shim. A shebang file with no extension is not executable from cmd or
REM PowerShell, so the plugin ships both and PATH picks whichever the shell can
REM run. Same script either way.
node "%~dp0surex" %*
