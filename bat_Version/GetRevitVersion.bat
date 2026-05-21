@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM ============================================================
REM  GetRevitVersion.bat
REM  インストール済みの Revit バージョンをレジストリから確認します
REM  ダブルクリックで実行できます
REM ============================================================

echo ============================================================
echo  Revit バージョン確認
echo  実行日時: %DATE% %TIME%
echo  PC名    : %COMPUTERNAME%
echo ============================================================
echo.

set "FOUND=0"

for %%Y in (2019 2020 2021 2022 2023 2024 2025 2026) do (
    set "KEY=HKLM\SOFTWARE\Autodesk\Revit\%%Y"
    reg query "!KEY!" >nul 2>&1
    if !errorlevel! equ 0 (
        set "FOUND=1"
        echo [Revit %%Y] インストール済み

        REM --- インストールパス ---
        for /f "tokens=2*" %%a in ('reg query "!KEY!" /v "InstallLocation" 2^>nul ^| findstr /i "InstallLocation"') do (
            echo   インストール先  : %%b
        )

        REM --- 詳細バージョン番号 ---
        for /f "tokens=2*" %%a in ('reg query "!KEY!" /v "Version" 2^>nul ^| findstr /i "Version"') do (
            echo   バージョン番号  : %%b
        )

        REM --- LanguagePack ---
        for /f "tokens=2*" %%a in ('reg query "!KEY!" /v "Language" 2^>nul ^| findstr /i "Language"') do (
            echo   言語コード      : %%b
        )

        echo.
    )
)

if !FOUND! equ 0 (
    echo Revit はインストールされていません。
    echo.
)

REM --- Revit Server の確認 ---
echo [Revit Server]
reg query "HKLM\SOFTWARE\Autodesk\RevitServer" >nul 2>&1
if %errorlevel% equ 0 (
    echo   Revit Server : インストール済み
    for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Autodesk\RevitServer" /v "Version" 2^>nul ^| findstr /i "Version"') do (
        echo   バージョン   : %%b
    )
) else (
    echo   Revit Server : 未インストール
)
echo.

echo ============================================================
echo  確認完了
echo ============================================================
pause
