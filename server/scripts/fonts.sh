#!/bin/sh
# Korean fonts for rendering score cards to PNG (Noto Sans KR, SIL Open Font License). Not kept in git.
set -e
cd "$(dirname "$0")/.."
mkdir -p fonts
for w in Medium Bold; do
  [ -f "fonts/NotoSansKR-$w.otf" ] || curl -fsSL -o "fonts/NotoSansKR-$w.otf" \
    "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/KR/NotoSansKR-$w.otf"
done
ls -l fonts
