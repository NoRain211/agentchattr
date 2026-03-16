@echo off
REM agentchattr — starts server + Claude + Codex
REM Each process runs in its own cmd window. Minimizing is safe — only closing kills them.
cd /d "%~dp0.."

REM Auto-create venv and install deps on first run
if not exist ".venv" (
    echo   Setting up virtual environment...
    python -m venv .venv
    .venv\Scripts\pip install -q -r requirements.txt >nul 2>nul
)

REM Start server in its own window
start "agentchattr-server" cmd /k "cd /d "%~dp0.." && .venv\Scripts\activate.bat && python run.py"

REM Wait for server to be ready
echo   Waiting for server...
:wait_server
netstat -ano | findstr :8300 | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 1 /nobreak >nul
    goto :wait_server
)
echo   Server is up.

REM Start Claude wrapper (if installed)
where claude >nul 2>&1
if %errorlevel% equ 0 (
    start "agentchattr-claude" /min cmd /k "cd /d "%~dp0.." && .venv\Scripts\activate.bat && python wrapper.py claude"
    echo   Claude wrapper launched.
) else (
    echo   Warning: "claude" not found on PATH — skipping
)

REM Start Codex wrapper (if installed)
where codex >nul 2>&1
if %errorlevel% equ 0 (
    start "agentchattr-codex" /min cmd /k "cd /d "%~dp0.." && .venv\Scripts\activate.bat && python wrapper.py codex"
    echo   Codex wrapper launched.
) else (
    echo   Warning: "codex" not found on PATH — skipping
)

echo.
echo   ==========================================
echo   agentchattr is running
echo   Chat UI:  http://localhost:8300
echo   ==========================================
echo.
echo   Agent wrappers are minimized in the taskbar.
echo   Close THIS window to stop the server.
echo   Press any key to open the chat UI...
pause >nul
start http://localhost:8300
