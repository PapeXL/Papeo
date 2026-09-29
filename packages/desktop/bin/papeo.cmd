@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "RESOURCES_DIR=%SCRIPT_DIR%.."
set "APP_EXECUTABLE=%RESOURCES_DIR%\..\Papeo.exe"
if not exist "%APP_EXECUTABLE%" (
  echo Bundled Papeo executable not found at %APP_EXECUTABLE% 1>&2
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
set "PASEO_NODE_ENV=production"
rem Fork build: always use the fork's home so this CLI never talks to the stock
rem Paseo daemon. Do not honour an inherited PASEO_HOME: stock Paseo terminals
rem export theirs. PAPEO_HOME is the override. Must match fork-identity.ts.
if defined PAPEO_HOME (set "PASEO_HOME=%PAPEO_HOME%") else (set "PASEO_HOME=%USERPROFILE%\.papeo")
rem PASEO_DESKTOP_MANAGED marks daemons started through this bundled CLI as
rem desktop-managed, so the desktop app restarts them when it upgrades.
set "PASEO_DESKTOP_MANAGED=1"
set "PASEO_CLI=%~f0"
"%APP_EXECUTABLE%" --disable-warning=DEP0040 "%RESOURCES_DIR%\app.asar.unpacked\dist\daemon\node-entrypoint-runner.js" node-script "%RESOURCES_DIR%\app.asar\node_modules\@getpaseo\cli\dist\index.js" %*
exit /b %errorlevel%
