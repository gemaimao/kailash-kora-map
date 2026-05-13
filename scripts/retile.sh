#!/bin/bash
# 底图重新切片脚本
# 使用方法：修改 basemap.png 后运行
#   bash scripts/retile.sh
#
# 前置依赖：brew install gdal

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_IMG="$PROJECT_DIR/assets/basemap.png"
TILES_DIR="$PROJECT_DIR/assets/tiles"
TMP_GEOTIFF="/tmp/kailash_basemap_geo.tif"

# 底图地理范围 (与 data/basemap.json 中的 bounds 一致)
SOUTH=30.942295
WEST=81.239086
NORTH=31.127748
EAST=81.406700

# 缩放级别
MIN_ZOOM=11
MAX_ZOOM=16

echo "=== 冈仁波齐底图切片 ==="
echo "源图: $SRC_IMG"

if [ ! -f "$SRC_IMG" ]; then
  echo "❌ 底图文件不存在: $SRC_IMG"
  exit 1
fi

# 修复 PROJ 路径 (macOS Homebrew)
PROJ_SHARE="$(brew --prefix proj 2>/dev/null)/share/proj" || true
if [ -d "$PROJ_SHARE" ]; then
  export PROJ_DATA="$PROJ_SHARE"
  echo "PROJ_DATA=$PROJ_DATA"
fi

echo "1/3 地理配准..."
gdal_translate -of GTiff \
  -a_ullr $WEST $NORTH $EAST $SOUTH \
  -a_srs EPSG:4326 \
  "$SRC_IMG" "$TMP_GEOTIFF"

echo "2/3 清理旧瓦片..."
rm -rf "$TILES_DIR"

echo "3/3 生成瓦片 (zoom $MIN_ZOOM-$MAX_ZOOM)..."
gdal2tiles.py \
  -z "$MIN_ZOOM-$MAX_ZOOM" \
  -w none \
  --xyz \
  "$TMP_GEOTIFF" "$TILES_DIR"

# 统计
TILE_COUNT=$(find "$TILES_DIR" -name "*.png" | wc -l | tr -d ' ')
TILE_SIZE=$(du -sh "$TILES_DIR" | cut -f1)

echo ""
echo "✅ 切片完成"
echo "   瓦片数: $TILE_COUNT"
echo "   总大小: $TILE_SIZE"
echo "   目录:   $TILES_DIR"

# 清理临时文件
rm -f "$TMP_GEOTIFF"
