@echo off
rem ============================================================
rem Kanga Toolkit — installazione pacchetti SDK Android
rem Uso: scripts\install-sdk-packages.bat [percorso_sdk] [java_home]
rem Default: %LOCALAPPDATA%\Android\Sdk e Microsoft OpenJDK 17
rem ============================================================
setlocal

set "SDK_ROOT=%~1"
if "%SDK_ROOT%"=="" set "SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"

set "JAVA_HOME=%~2"
if "%JAVA_HOME%"=="" set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot"

echo SDK:    %SDK_ROOT%
echo JAVA:   %JAVA_HOME%
echo.

"%SDK_ROOT%\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="%SDK_ROOT%" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
echo.
echo Fine. Pacchetti: platform-tools, android-35, build-tools 35.0.0
endlocal
