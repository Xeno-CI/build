#!/bin/sh
# XenoCast CLI installer: curl -fsSL https://github.com/Xeno-CI/xenocast/releases/latest/download/install.sh | sh
# (the old address https://github.com/Xeno-CI/build/releases/latest/download/install.sh serves this same file).
# Downloads the single executable for this OS/CPU from Xeno-CI/xenocast, verifies it against SHA256SUMS, installs
# `xenocast` and links the old name `xenoci` to it (existing scripts, CI jobs and MCP configs keep working).
#   XENOCAST_VERSION=v1.4.1    pin a release (default: latest; XENOCI_VERSION works too)
#   XENOCI_INSTALL_DIR=/path   install directory (default: /usr/local/bin if writable, else ~/.local/bin)
#   XENOCI_BASE_URL=url        download from a mirror holding the same release assets (flat folder)
#   XENOCAST_INSTALL_BASE=url  the host in front of /Xeno-CI/xenocast/releases (default https://github.com)
set -eu
REPO=Xeno-CI/xenocast
VERSION=${XENOCAST_VERSION:-${XENOCI_VERSION:-latest}}
HOST=${XENOCAST_INSTALL_BASE:-https://github.com}
case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "xenocast: unsupported OS $(uname -s) (Windows: install.ps1)" >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "xenocast: unsupported CPU $(uname -m)" >&2; exit 1 ;; esac
[ "$os-$arch" = darwin-x64 ] && { echo "xenocast: Intel Mac is not supported (use: npx -y -p github:xeno-ci/xenocast xenocast)" >&2; exit 1; }
libc=""
if [ "$os" = linux ] && { [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ] || ldd --version 2>&1 | grep -qi musl; }; then libc=-musl; fi
asset="xenocast-$os-$arch$libc"
if [ -n "${XENOCI_BASE_URL:-}" ]; then base=${XENOCI_BASE_URL%/}
elif [ "$VERSION" = latest ]; then base="${HOST%/}/$REPO/releases/latest/download"; else base="${HOST%/}/$REPO/releases/download/$VERSION"; fi
if [ "$libc" = -musl ] && [ ! -e /usr/lib/libstdc++.so.6 ]; then
  if command -v apk >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then apk add --no-cache -q libstdc++ libgcc >/dev/null
  else echo "xenocast: this musl system needs libstdc++ (Alpine: apk add libstdc++)" >&2; exit 1; fi
fi
if [ -n "${XENOCI_INSTALL_DIR:-}" ]; then dir=$XENOCI_INSTALL_DIR
elif [ -w /usr/local/bin ]; then dir=/usr/local/bin
else dir="$HOME/.local/bin"; fi
mkdir -p "$dir"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT INT TERM
fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"; else wget -q -O "$2" "$1"; fi; }
fetch "$base/$asset" "$tmp/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS"
want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS")
[ -n "$want" ] || { echo "xenocast: $asset not listed in SHA256SUMS" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/$asset" | awk '{print $1}'); else got=$(shasum -a 256 "$tmp/$asset" | awk '{print $1}'); fi
[ "$got" = "$want" ] || { echo "xenocast: checksum mismatch for $asset (expected $want, got $got)" >&2; exit 1; }
chmod 755 "$tmp/$asset"
[ "$os" = darwin ] && command -v codesign >/dev/null 2>&1 && codesign --force -s - "$tmp/$asset" >/dev/null 2>&1 || true
installed=$("$tmp/$asset" --version 2>&1) || { echo "xenocast: $asset does not run on this system: $(echo "$installed" | head -1)" >&2; exit 1; }
mv "$tmp/$asset" "$dir/xenocast"
rm -f "$dir/xenoci" && ln -s xenocast "$dir/xenoci"
echo "xenocast $installed installed: $dir/xenocast (old name: $dir/xenoci)"
case ":$PATH:" in *":$dir:"*) ;; *) echo "add to PATH: export PATH=\"$dir:\$PATH\"" ;; esac
