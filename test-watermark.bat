@echo off
chcp 65001 >nul
echo ========================================
echo 智能水印去除功能 - 快速测试
echo ========================================
echo.

echo [1/3] 检查依赖...
cd /d "%~dp0server"
where node >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未安装 Node.js
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误: 未安装 pnpm
    echo 请运行: npm install -g pnpm
    pause
    exit /b 1
)

echo ✅ 依赖检查通过
echo.

echo [2/3] 安装/检查 Sharp 库...
pnpm list sharp >nul 2>&1
if errorlevel 1 (
    echo 正在安装 Sharp...
    pnpm add sharp
)
echo ✅ Sharp 已就绪
echo.

echo [3/3] 启动服务器...
echo.
echo ========================================
echo 服务器启动中...
echo 浏览器将自动打开 http://localhost:3000
echo ========================================
echo.
echo 💡 使用提示:
echo   1. 点击"本地去水印"按钮
echo   2. 选择要处理的图片
echo   3. 选择算法（推荐使用"组合拳"）
echo   4. 点击"开始去水印"
echo   5. 在使用记录中查看结果
echo.
echo 按 Ctrl+C 停止服务器
echo ========================================
echo.

pnpm start
