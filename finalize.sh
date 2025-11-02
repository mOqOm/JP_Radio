#!/bin/bash

PLUGIN_DIR="/data/plugins/music_service/jp_radio"

# 旧バージョンがあれば削除
if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
fi

# 親ディレクトリがなければ作成
mkdir -p "$PLUGIN_DIR"

cat >dist/package.json <<!EOF
{
  "type": "commonjs"
}
!EOF

cp -r src/UIConfig.json dist/
cp -r i18n /
cp -r src/assets dist/
