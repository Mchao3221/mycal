@echo off
rem 双击本文件即可把 DOCS_DIR 里的文档同步到阅读器(不需要装 Node)。
rem 配置写在项目根目录的 .dev.vars 里:DOCS_DIR / SYNC_URL / SYNC_PASSWORD
rem
rem 用 PowerShell 5.1(Windows 自带)+ -ExecutionPolicy Bypass,避免默认策略拦脚本。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\sync-docs.ps1" %*
echo.
pause
