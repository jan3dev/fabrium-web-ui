#!/bin/sh
# Design-system guard (AGENTS.md, Design). Run from packages/web.
cd "$(dirname "$0")/.." || exit 2
status=0

# fail <message> <grep output>
fail() {
  if [ -n "$2" ]; then
    printf '\n✗ %s\n%s\n' "$1" "$2"
    status=1
  fi
}

# Source files the code rules apply to: no tests, no token sheets, no brand hex.
src_grep() {
  grep -rnE "$1" src --include='*.ts' --include='*.tsx' \
    | grep -vE '^src/styles/|^src/components/brand/colors\.ts:|\.test\.tsx?:'
}

fail "Raw hex colour; use a token class" "$(src_grep '#[0-9a-fA-F]{3,8}\b')"
fail "Tailwind palette colour; use a semantic token" \
  "$(src_grep '\b(bg|text|border|ring|fill|stroke)-(zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]')"
fail "Primitive token outside styles/; use a semantic token" "$(src_grep 'var\(--fab-')"
fail "lucide-react imported directly; import from @/components/icons" \
  "$(src_grep "from [\"']lucide-react[\"']" | grep -v '^src/components/icons/index\.ts:')"
fail "Desktop/Nostr dependency" "$(src_grep '@tauri-apps/|nostr-tools')"

# Upstream design-system and company names, anywhere in the package. The pattern
# is split so this script does not match itself.
banned="aq""ua|ja""n3"
fail "Upstream name in packages/web" "$(grep -rniE "$banned" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=test-results \
  --exclude-dir=storybook-static --exclude-dir=playwright-report)"

[ "$status" -eq 0 ] && echo "check-design: ok"
exit "$status"
