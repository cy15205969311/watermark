@echo off
echo ========================================
echo 去水印下载助手 - 启动脚本
echo ========================================
echo.

echo [1/2] 启动后端服务器...
cd server
start cmd /k "npm start"
cd ..

timeout /t 3 /nobreak >nul

echo [2/2] 启动前端开发服务器...
cd client
start cmd /k "npm run dev"
cd ..

echo.
echo ========================================
echo 启动完成！
echo 后端: http://localhost:3000
echo 前端: http://localhost:5173
echo ========================================
pause
