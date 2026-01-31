@echo off
echo ========================================
echo API 测试脚本
echo ========================================
echo.

echo [测试 1] 获取历史记录...
curl -s http://localhost:3000/api/history
echo.
echo.

echo [测试 2] 创建新记录...
curl -s -X POST http://localhost:3000/api/parse ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://test.com/video\",\"platform\":\"测试\",\"thumbnailUrl\":\"https://picsum.photos/400/300\",\"status\":\"success\"}"
echo.
echo.

echo [测试 3] 提取图片...
curl -s -X POST http://localhost:3000/api/extract-image ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://ue.818ps.com/v4/?picId=5855623\",\"platform\":\"818ps\"}"
echo.
echo.

echo ========================================
echo 测试完成！
echo ========================================
pause
