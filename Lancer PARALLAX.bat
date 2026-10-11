@echo off
rem ==================================================================
rem  PARALLAX - lanceur Windows
rem  Ouvre dist\PARALLAX.html dans Google Chrome (sinon, navigateur par defaut).
rem  Aucun serveur, aucune installation : tout est contenu dans le fichier.
rem ==================================================================
setlocal
set "FILE=%~dp0dist\PARALLAX.html"
if not exist "%FILE%" (
  echo Fichier introuvable : "%FILE%"
  echo Verifiez que le dossier "dist" est present a cote de ce lanceur.
  pause
  exit /b 1
)
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME (
  start "" "%CHROME%" --new-window "%FILE%"
) else (
  echo Google Chrome n'a pas ete trouve : ouverture avec le navigateur par defaut.
  start "" "%FILE%"
)
endlocal
