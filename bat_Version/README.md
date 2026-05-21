# bat_Version

Revit および各種ツールのバージョン情報を収集するバッチファイル群です。

## ファイル一覧

| ファイル名 | 内容 |
|---|---|
| `GetVersionInfo.bat` | Revit / AutoCAD / Navisworks / .NET / Python / Office のバージョンをまとめて収集し、テキストファイルに出力 |
| `GetRevitVersion.bat` | Revit のバージョンのみをレジストリから詳細確認（画面表示のみ） |

## 使い方

1. バッチファイルをダブルクリックして実行します。
2. `GetVersionInfo.bat` は同フォルダに `VersionReport_<PC名>_<日付>.txt` を生成します。
3. `GetRevitVersion.bat` はコンソール画面に結果を表示します。

## 対応ツール / 対応バージョン

### `GetVersionInfo.bat`

- **Autodesk Revit** : 2019 ～ 2026（レジストリ確認）
- **Autodesk AutoCAD** : 2019 ～ 2026（レジストリ確認）
- **Autodesk Navisworks** : Manage / Simulate 2019 ～ 2026（実行ファイル確認）
- **.NET Framework** : 4.7.2 / 4.8 / 4.8.1（レジストリ確認）
- **Python** : PATH が通っているバージョン
- **Microsoft Office** : 2010 / 2013 / 365（レジストリ確認）

### `GetRevitVersion.bat`

- Revit 2019 ～ 2026
- Revit Server

## 動作環境

- Windows 10 / 11 (64bit)
- 管理者権限不要（レジストリの読み取りのみ）

## 今後の改良予定

- Dynamo / pyRevit などのアドインのバージョン確認
- 収集結果を CSV 形式で出力
- 複数 PC 分の結果を一括収集する機能
