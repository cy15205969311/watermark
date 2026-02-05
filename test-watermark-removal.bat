@echo off
chcp 65001 >nul
echo ========================================
echo 测试图怪兽水印去除功能
echo ========================================
echo.

cd server

echo [1/3] 测试图怪兽链接提取...
curl -X POST http://localhost:3000/api/extract-image ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://818ps.com/u/002dKJSb-1?user_source=r1537041\",\"platform\":\"818ps\"}"

echo.
echo.
echo [2/3] 等待3秒...
timeout /t 3 /nobreak >nul

echo.
echo [3/3] 测试完成！
echo.
echo 请检查以下内容：
echo 1. 图片是否成功提取
echo 2. 水印是否已被去除
echo 3. 图片质量是否满意
echo.
pause
