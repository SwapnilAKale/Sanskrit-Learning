@echo off
rem Removes SanskritLearning for the current Windows user. Options: -KeepModels or -DeleteModels (otherwise it asks).
rem Everything runs on this one line, because the uninstaller deletes this file while it runs.
cd /d "%TEMP%" & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1" %* & exit /b
