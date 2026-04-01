#!/bin/bash

# XTerm File Manager - Release Build Script
# 用途：编译发版到 build/releases 目录
# 使用方法：./build-release.sh [平台]
# 平台选项：darwin-arm64 (默认), darwin-amd64, windows, linux, all

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 发版输出目录
RELEASE_DIR="$SCRIPT_DIR/build/releases"

# 创建发版目录
mkdir -p "$RELEASE_DIR"

# 获取版本号（从 wails.json 中提取）
VERSION=$(grep '"version"' wails.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
if [ -z "$VERSION" ]; then
    VERSION="dev"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  XTerm File Manager - Release Build${NC}"
echo -e "${BLUE}  Version: ${VERSION}${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 获取平台参数（默认为当前系统）
PLATFORM="${1:-darwin-arm64}"

# 步骤 1: 清理缓存
echo -e "${YELLOW}[1/5] 🧹 清理缓存和旧文件...${NC}"
rm -rf build/bin/*
rm -rf frontend/dist/assets
cd frontend && rm -rf node_modules/.vite .vite && cd ..
echo -e "${GREEN}✓ 缓存清理完成${NC}"
echo ""

# 步骤 2: 安装依赖（如果需要）
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}[2/5] 📦 安装前端依赖...${NC}"
    cd frontend && npm install && cd ..
    echo -e "${GREEN}✓ 前端依赖安装完成${NC}"
else
    echo -e "${GREEN}[2/5] ✓ 前端依赖已存在，跳过安装${NC}"
fi
echo ""

# 编译函数
build_platform() {
    local platform=$1
    local output_name=$2
    local build_platform=$3

    if [[ "$platform" == "Linux" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
        echo -e "${YELLOW}[3/5] ⚠️ 跳过 ${platform}...${NC}"
        echo -e "  Wails 无法在 macOS 上交叉编译 Linux 版本，请在 Linux 环境中执行 ./build-release.sh linux"
        echo ""
        return 0
    fi
    
    echo -e "${YELLOW}[3/5] 🔨 编译 ${platform}...${NC}"
    wails build -platform "$build_platform" -clean
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗ ${platform} 编译失败${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✓ ${platform} 编译成功${NC}"
    echo ""

    if [[ "$platform" == "macOS"* ]] && [[ "$(uname -s)" == "Darwin" ]] && [ -f "scripts/post-build-sign.sh" ]; then
        echo -e "${YELLOW}[3/5] 🔐 重新签名 macOS 应用...${NC}"
        ./scripts/post-build-sign.sh
        echo ""
    fi
    
    # 移动到 releases 目录
    echo -e "${YELLOW}[4/5] 📦 打包到 releases...${NC}"
    rm -f "$RELEASE_DIR/${output_name}.zip" "$RELEASE_DIR/${output_name}.exe" "$RELEASE_DIR/${output_name}.tar.gz"
    
    if [[ "$platform" == "macOS"* ]]; then
        # macOS 应用打包成 zip
        if [ -d "build/bin/xterm-file-manager.app" ]; then
            cd build/bin
            zip -r "$RELEASE_DIR/${output_name}.zip" xterm-file-manager.app -q
            cd "$SCRIPT_DIR"
            echo -e "${GREEN}✓ 已打包: ${output_name}.zip${NC}"
            
            # 显示文件大小
            local size=$(du -h "$RELEASE_DIR/${output_name}.zip" | cut -f1)
            echo -e "  大小: ${size}"
        fi
    elif [[ "$platform" == "Windows" ]]; then
        # Windows 可执行文件直接复制
        if [ -f "build/bin/xterm-file-manager.exe" ]; then
            cp build/bin/xterm-file-manager.exe "$RELEASE_DIR/${output_name}.exe"
            echo -e "${GREEN}✓ 已复制: ${output_name}.exe${NC}"
            
            # 显示文件大小
            local size=$(du -h "$RELEASE_DIR/${output_name}.exe" | cut -f1)
            echo -e "  大小: ${size}"
        fi
    elif [[ "$platform" == "Linux" ]]; then
        # Linux 可执行文件打包成 tar.gz
        if [ -f "build/bin/xterm-file-manager" ]; then
            cd build/bin
            tar -czf "$RELEASE_DIR/${output_name}.tar.gz" xterm-file-manager
            cd "$SCRIPT_DIR"
            echo -e "${GREEN}✓ 已打包: ${output_name}.tar.gz${NC}"
            
            # 显示文件大小
            local size=$(du -h "$RELEASE_DIR/${output_name}.tar.gz" | cut -f1)
            echo -e "  大小: ${size}"
        fi
    fi
    echo ""
}

# 根据平台参数编译
case "$PLATFORM" in
    darwin-arm64|mac-arm64|macos-arm64|arm64)
        build_platform "macOS (Apple Silicon)" "xterm-file-manager-v${VERSION}-darwin-arm64" "darwin/arm64"
        ;;
    darwin-amd64|mac-amd64|macos-amd64|intel)
        build_platform "macOS (Intel)" "xterm-file-manager-v${VERSION}-darwin-amd64" "darwin/amd64"
        ;;
    windows|win|windows-amd64)
        build_platform "Windows" "xterm-file-manager-v${VERSION}-windows-amd64" "windows/amd64"
        ;;
    linux|linux-amd64)
        build_platform "Linux" "xterm-file-manager-v${VERSION}-linux-amd64" "linux/amd64"
        ;;
    all)
        echo -e "${BLUE}编译所有平台...${NC}"
        echo ""
        build_platform "macOS (Apple Silicon)" "xterm-file-manager-v${VERSION}-darwin-arm64" "darwin/arm64"
        build_platform "macOS (Intel)" "xterm-file-manager-v${VERSION}-darwin-amd64" "darwin/amd64"
        build_platform "Windows" "xterm-file-manager-v${VERSION}-windows-amd64" "windows/amd64"
        build_platform "Linux" "xterm-file-manager-v${VERSION}-linux-amd64" "linux/amd64"
        ;;
    *)
        echo -e "${RED}✗ 不支持的平台: $PLATFORM${NC}"
        echo ""
        echo "支持的平台："
        echo "  darwin-arm64   - macOS Apple Silicon (M1/M2/M3)"
        echo "  darwin-amd64   - macOS Intel"
        echo "  windows        - Windows 64-bit"
        echo "  linux          - Linux 64-bit"
        echo "  all            - 编译所有平台"
        echo ""
        echo "使用方法: ./build-release.sh [平台]"
        exit 1
        ;;
esac

# 步骤 5: 完成
echo -e "${YELLOW}[5/5] ✅ 完成！${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  发版文件已生成到:${NC}"
echo -e "${GREEN}  ${RELEASE_DIR}${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "文件列表:"
ls -lh "$RELEASE_DIR" | tail -n +2
echo ""

# 如果是 macOS 平台，提供快速测试命令
if [[ "$PLATFORM" == darwin-* ]] || [[ "$PLATFORM" == mac-* ]] || [[ "$PLATFORM" == macos-* ]] || [[ "$PLATFORM" == arm64 ]] || [[ "$PLATFORM" == intel ]]; then
    echo -e "${BLUE}快速测试:${NC}"
    echo "  1. 解压: cd $RELEASE_DIR && unzip xterm-file-manager-v${VERSION}-darwin-*.zip"
    echo "  2. 测试: open xterm-file-manager.app"
    echo ""
fi
