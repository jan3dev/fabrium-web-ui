#!/bin/sh
# Install the host hardening and the auto-stop watcher of the agent VM image. Run as root; idempotent.
# prepare-image.sh runs it. See "Host hardening and auto-stop" in deploy/README.md.
set -eu

[ "$(id -u)" -eq 0 ] || { echo "install.sh: run as root" >&2; exit 1; }
cd "$(dirname "$0")"

if ! command -v nft >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y nftables
fi
# Disable only, never stop: its ExecStop flushes every table, Docker's included.
if systemctl is-enabled --quiet nftables 2>/dev/null; then
  systemctl disable nftables
fi

install -m 0644 99-mptcp-off.conf /etc/sysctl.d/99-mptcp-off.conf
install -m 0644 ipopts-drop.nft /etc/nftables.d-ipopts-drop.nft
install -m 0644 ipopts-drop.service fabrium-auto-stop.service fabrium-auto-stop.timer /etc/systemd/system/
install -m 0755 fabrium-auto-stop /usr/local/sbin/fabrium-auto-stop

sysctl --system >/dev/null
systemctl daemon-reload
systemctl enable ipopts-drop.service fabrium-auto-stop.timer
# The unit has no ExecStop, so a restart reloads this table and touches no other.
systemctl restart ipopts-drop.service
systemctl start fabrium-auto-stop.timer

[ "$(sysctl -n net.mptcp.enabled)" = 0 ] || { echo "install.sh: net.mptcp.enabled is not 0" >&2; exit 1; }
nft list table inet ipopts_drop >/dev/null
systemctl is-active --quiet fabrium-auto-stop.timer
echo "install.sh: MPTCP off, ipopts_drop table loaded, auto-stop timer active"
