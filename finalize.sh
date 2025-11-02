#!/bin/bash
cat >dist/package.json <<!EOF
{
  "type": "commonjs"
}
!EOF

cp -r src/UIConfig.json dist/
cp -r i18n /
cp -r src/assets dist/
