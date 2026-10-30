@echo off
rem Compila o Jarvis Desktop com o compilador C# que ja vem no Windows (.NET Framework 4.8). Nada para baixar.
setlocal
cd /d "%~dp0"
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set CSC=%FW%\csc.exe
if not exist "%CSC%" (echo Nao achei o csc.exe em %FW% & exit /b 1)

rem 1) Recorta as animacoes do Jarvis Code da vitrine (sprites\fonte\vitrine.gif), se ainda nao existirem.
if not exist sprites\parado.txt (
  "%CSC%" -nologo -optimize -out:tools\GifSprites.exe -r:System.Drawing.dll tools\GifSprites.cs || exit /b 1
  tools\GifSprites.exe sprites\fonte\vitrine.gif sprites || exit /b 1
)

rem 2) O app.
"%CSC%" -nologo -optimize -target:winexe -out:JarvisDesktop.exe -win32manifest:src\app.manifest -win32icon:src\jarvis.ico ^
  -r:System.Web.Extensions.dll -r:System.Windows.Forms.dll -r:System.Drawing.dll src\*.cs || exit /b 1
rem 3) O instalador base (o site junta o pacote do Jarvis no final dele na hora do download).
"%CSC%" -nologo -optimize -target:winexe -out:JarvisSetup.exe -win32icon:src\jarvis.ico ^
  -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.Management.dll -r:System.IO.Compression.dll -r:System.IO.Compression.FileSystem.dll -r:Microsoft.CSharp.dll -r:System.Core.dll installer\Setup.cs || exit /b 1
echo Pronto: %~dp0JarvisDesktop.exe e %~dp0JarvisSetup.exe
