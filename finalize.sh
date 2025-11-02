#!/bin/bash
cat >dist/package.json <<!EOF
{
  "type": "commonjs"
}
!EOF

cp -r src/UIConfig.json dist/
cp -r src/assets dist/
