@echo off
rem SanskritLearning setup for the current Windows user. From PowerShell or Command Prompt, in this folder: .\setup.cmd
rem -ExecutionPolicy Bypass applies to this one run only; no Windows setting is changed.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %* & exit /b
