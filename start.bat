@echo off
echo ========================================
echo Watermark helper startup
echo ========================================
echo.

echo [1/2] Starting backend server...
cd server
start cmd /k "npm start"
cd ..

timeout /t 3 /nobreak >nul

echo [2/2] Starting frontend dev server...
cd client
start cmd /k "npm run dev"
cd ..

echo.
echo ========================================
echo Start complete
echo Local backend:   http://localhost:3000
echo Local frontend:  http://localhost:5173
echo LAN access: check the server and Vite windows for the Network URL
echo ========================================
pause
