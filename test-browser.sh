#!/bin/bash

echo "测试 Wails 开发服务器..."
echo ""

# 检查端口是否开放
echo "1. 检查端口 34115..."
if lsof -ti:34115 > /dev/null 2>&1; then
    echo "   ✅ 端口 34115 正在使用中"
else
    echo "   ❌ 端口 34115 未使用"
fi

# 尝试访问
echo ""
echo "2. 尝试访问 http://localhost:34115..."
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:34115 2>&1)
if [ "$response" = "200" ]; then
    echo "   ✅ 服务器响应正常 (HTTP $response)"
    echo ""
    echo "   请在浏览器中打开: http://localhost:34115"
    echo "   或者运行: open http://localhost:34115"
else
    echo "   ❌ 服务器无响应 (HTTP $response)"
    echo "   请确保 wails dev 正在运行"
fi

echo ""
echo "3. 检查前端构建..."
if [ -f "frontend/dist/index.html" ]; then
    echo "   ✅ frontend/dist/index.html 存在"
else
    echo "   ❌ frontend/dist/index.html 不存在"
    echo "   请运行: cd frontend && npm run build"
fi
