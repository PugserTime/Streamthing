@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo [ERROR] Node.js 22.5+ not found. Install the LTS from https://nodejs.org then re-run. & pause & exit /b 1)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (echo [ERROR] Node 22.5+ required. You have & node -v & pause & exit /b 1)
if not exist .env (copy .env.example .env >nul & echo [INFO] Created .env - add TMDB_API_KEY / YOUTUBE_API_KEY to enable those features.)
if not exist node_modules (echo [INFO] Installing dependencies... & call npm install --no-audit --no-fund || (echo [ERROR] npm install failed & pause & exit /b 1))
if not exist web\dist\index.html (echo [INFO] Building frontend... & call npm run build || (echo [ERROR] build failed & pause & exit /b 1))
echo [INFO] Starting on http://127.0.0.1:8080  (logs: data\app.log)
start "" "http://127.0.0.1:8080"
node --experimental-sqlite server\index.mjs
echo [INFO] Server stopped.
pause
