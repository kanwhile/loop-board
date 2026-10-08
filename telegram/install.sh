#!/usr/bin/env bash
# ติดตั้ง/ถอนบอทเป็น launchd agent ของ user นี้
#   telegram/install.sh            ติดตั้งหรือรีสตาร์ต
#   telegram/install.sh uninstall  ถอน
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LABEL=com.loop-board.telegram-bot
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ENV_FILE="$HOME/.config/loop-board-bot/env"
LOG="$HOME/Library/Logs/loop-board-bot.log"
DOMAIN="gui/$(id -u)"

die() { echo "install.sh: $*" >&2; exit 1; }

if [ "${1:-}" = uninstall ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "ถอนแล้ว (state ยังอยู่ที่ ~/.local/state/loop-board-bot ลบเองได้)"
  exit 0
fi

BUN=$(command -v bun) || die "ไม่เจอ bun"
[ -f "$ENV_FILE" ] || die "ยังไม่มี $ENV_FILE ดู telegram/README.md ขั้นที่ 2"
chmod 600 "$ENV_FILE"
grep -q '^TELEGRAM_OWNER_ID=[0-9]' "$ENV_FILE" || die "ยังไม่ได้ใส่ TELEGRAM_OWNER_ID ใน $ENV_FILE"

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>$HERE/bot.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:$(dirname "$BUN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout คืนก่อนตัวเก่าปิดเสร็จ ถ้า bootstrap ทันทีจะได้ "Bootstrap failed: 5"
for _ in $(seq 20); do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "ติดตั้งแล้ว: $LABEL"
echo "log: tail -f $LOG"
