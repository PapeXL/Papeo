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
rem Fork build: keep this CLI on the fork's home so it never talks to the stock
rem Paseo daemon in %USERPROFILE%\.paseo. Must match FORK_HOME_DIR_NAME.
if not defined PASEO_HOME set "PASEO_HOME=%USERPROFILE%\.papeo"
rem PASEO_DESKTOP_MANAGED marks daemons started through this bundled CLI as
rem desktop-managed, so the desktop app restarts them when it upgrades.
set "PASEO_DESKTOP_MANAGED=1"
set "PASEO_CLI=%~f0"
"%APP_EXECUTABLE%" --disable-warning=DEP0040 "%RESOURCES_DIR%\app.asar.unpacked\dist\daemon\node-entrypoint-runner.js" node-script "%RESOURCES_DIR%\app.asar\node_modules\@getpaseo\cli\dist\index.js" %*
exit /b %errorlevel%
