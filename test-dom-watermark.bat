@echo off
chcp 65001 >nul
echo ========================================
echo 测试DOM文字水印去除功能
echo ========================================
echo.

cd server

echo [测试案例] 图怪兽Banner类型图片（包含DOM文字水印）
echo 链接: https://818ps.com/u/002dKJSd-1?user_source=r1537041
echo.

echo [1/2] 开始提取图片...
curl -X POST http://localhost:3000/api/extract-image ^
  -H "Content-Type: application/json" ^
  -d "{\"url\":\"https://818ps.com/u/002dKJSd-1?user_source=r1537041\",\"platform\":\"818ps\"}"

echo.
echo.
echo [2/2] 测试完成！
echo.
echo 请检查以下内容：
echo 1. 图片是否成功提取
echo 2. DOM文字水印是否已被去除
echo 3. 主要内容是否完整
echo 4. 查看控制台日志中的清理详情
echo.
echo 预期效果：
echo - 左下角的"马迎新春"等文字水印应该被移除
echo - Banner主体内容（马、日期等）应该保留
echo - 控制台应该显示"DOM水印清理完成！共移除 X 个水印元素"
echo.
pause
