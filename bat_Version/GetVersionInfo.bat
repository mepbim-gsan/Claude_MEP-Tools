@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ============================================================
REM  GetVersionInfo.bat
REM  Revit・各種ツールのバージョン情報を収集してテキスト出力します
REM  使い方: ダブルクリックで実行 → 同フォルダにレポートを生成
REM ============================================================

set "SCRIPT_DIR=%~dp0"
set "DATE_STR=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%"
set "OUTPUT_FILE=%SCRIPT_DIR%VersionReport_%COMPUTERNAME%_%DATE_STR%.txt"

echo ============================================================
echo  バージョン情報収集ツール
echo ============================================================
echo.

(
    echo ============================================================
    echo  バージョン情報レポート
    echo  収集日時  : %DATE% %TIME%
    echo  コンピュータ: %COMPUTERNAME%
    echo  ユーザー  : %USERNAME%
    echo ============================================================
    echo.
) > "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM OS情報
REM ------------------------------------------------------------
(
    echo [OS情報]
    for /f "tokens=2 delims==" %%a in ('wmic os get Caption /value 2^>nul ^| findstr "="') do echo   OS名     : %%a
    for /f "tokens=2 delims==" %%a in ('wmic os get Version /value 2^>nul ^| findstr "="') do echo   バージョン: %%a
    for /f "tokens=2 delims==" %%a in ('wmic os get OSArchitecture /value 2^>nul ^| findstr "="') do echo   アーキ   : %%a
    echo.
) >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM Autodesk Revit
REM ------------------------------------------------------------
(
    echo [Autodesk Revit]
    set "REVIT_FOUND=0"
) >> "%OUTPUT_FILE%"

for %%Y in (2019 2020 2021 2022 2023 2024 2025 2026) do (
    set "RKEY=HKLM\SOFTWARE\Autodesk\Revit\%%Y"
    reg query "!RKEY!" >nul 2>&1
    if !errorlevel! equ 0 (
        set "REVIT_FOUND=1"
        set "RVER="
        for /f "tokens=2*" %%a in ('reg query "!RKEY!" /v "Version" 2^>nul ^| findstr /i "Version"') do set "RVER=%%b"
        if defined RVER (
            echo   Revit %%Y : !RVER! >> "%OUTPUT_FILE%"
        ) else (
            echo   Revit %%Y : インストール済み ^(詳細バージョン取得不可^) >> "%OUTPUT_FILE%"
        )
    )
)

findstr /c:"Revit" "%OUTPUT_FILE%" >nul 2>&1
if !REVIT_FOUND! equ 0 (
    echo   Revit     : 未インストール >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM Autodesk AutoCAD
REM ------------------------------------------------------------
(
    echo [Autodesk AutoCAD]
    set "ACAD_FOUND=0"
) >> "%OUTPUT_FILE%"

for %%Y in (2019 2020 2021 2022 2023 2024 2025 2026) do (
    set "AKEY=HKLM\SOFTWARE\Autodesk\AutoCAD"
    for /f "tokens=*" %%k in ('reg query "!AKEY!" 2^>nul ^| findstr /i "AutoCAD"') do (
        for /f "tokens=2*" %%a in ('reg query "%%k" /v "ProductName" 2^>nul ^| findstr "ProductName"') do (
            echo   %%b >> "%OUTPUT_FILE%"
            set "ACAD_FOUND=1"
        )
    )
)

if !ACAD_FOUND! equ 0 (
    echo   AutoCAD   : 未インストール >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM Autodesk Navisworks
REM ------------------------------------------------------------
(
    echo [Autodesk Navisworks]
    set "NAVIS_FOUND=0"
) >> "%OUTPUT_FILE%"

for %%Y in (2019 2020 2021 2022 2023 2024 2025 2026) do (
    if exist "C:\Program Files\Autodesk\Navisworks Manage %%Y\roamer.exe" (
        echo   Navisworks Manage %%Y   : インストール済み >> "%OUTPUT_FILE%"
        set "NAVIS_FOUND=1"
    )
    if exist "C:\Program Files\Autodesk\Navisworks Simulate %%Y\roamer.exe" (
        echo   Navisworks Simulate %%Y : インストール済み >> "%OUTPUT_FILE%"
        set "NAVIS_FOUND=1"
    )
)

if !NAVIS_FOUND! equ 0 (
    echo   Navisworks : 未インストール >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM .NET Framework
REM ------------------------------------------------------------
(
    echo [.NET Framework]
) >> "%OUTPUT_FILE%"

for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v "Release" 2^>nul ^| findstr "Release"') do (
    set /a "REL=%%b"
    if !REL! geq 533320 echo   .NET Framework 4.8.1以上 ^(Release: %%b^) >> "%OUTPUT_FILE%"
    if !REL! geq 528040 if !REL! lss 533320 echo   .NET Framework 4.8 ^(Release: %%b^) >> "%OUTPUT_FILE%"
    if !REL! geq 461808 if !REL! lss 528040 echo   .NET Framework 4.7.2 ^(Release: %%b^) >> "%OUTPUT_FILE%"
    if !REL! lss 461808 echo   .NET Framework 4.7.1以下 ^(Release: %%b^) >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM Python
REM ------------------------------------------------------------
(
    echo [Python]
) >> "%OUTPUT_FILE%"

python --version >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%a in ('python --version 2^>&1') do echo   %%a >> "%OUTPUT_FILE%"
) else (
    echo   Python    : 未インストール または PATH未設定 >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

REM ------------------------------------------------------------
REM Microsoft Office
REM ------------------------------------------------------------
(
    echo [Microsoft Office]
    set "OFFICE_FOUND=0"
) >> "%OUTPUT_FILE%"

for %%V in (16.0 15.0 14.0) do (
    reg query "HKLM\SOFTWARE\Microsoft\Office\%%V\Excel\InstallRoot" /v "Path" >nul 2>&1
    if !errorlevel! equ 0 (
        set "OFFICE_FOUND=1"
        for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Office\%%V\Excel\InstallRoot" /v "Path" 2^>nul ^| findstr "Path"') do (
            echo   Office %%V : %%b >> "%OUTPUT_FILE%"
        )
    )
)

if !OFFICE_FOUND! equ 0 (
    echo   Office    : 未インストール >> "%OUTPUT_FILE%"
)
echo. >> "%OUTPUT_FILE%"

(
    echo ============================================================
    echo  収集完了
    echo ============================================================
) >> "%OUTPUT_FILE%"

echo 収集完了しました。
echo 出力先: %OUTPUT_FILE%
echo.
pause
