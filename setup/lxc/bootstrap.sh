#!/usr/bin/env bash
# Bootstrap-Script fuer frischen OpenClaw LXC
# Ausfuehren als root nach LXC-Erstellung
set -euo pipefail

echo "=== OpenClaw LXC Bootstrap ==="

# 1. User anlegen
if id openclaw &>/dev/null; then
  echo "[OK] User 'openclaw' existiert bereits"
else
  echo "[...] Erstelle User 'openclaw'"
  adduser --disabled-password --gecos "OpenClaw" openclaw
  echo "[OK] User 'openclaw' erstellt"
fi

# 2. Gruppen
usermod -aG sudo,docker openclaw 2>/dev/null || true
echo "[OK] User in sudo + docker Gruppen"

# 3. Passwordless sudo
if [ -f /etc/sudoers.d/openclaw ]; then
  echo "[OK] Passwordless sudo bereits konfiguriert"
else
  echo "openclaw ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/openclaw
  chmod 440 /etc/sudoers.d/openclaw
  echo "[OK] Passwordless sudo konfiguriert"
fi

# 4. loginctl enable-linger (KRITISCH fuer systemd user services)
if loginctl show-user openclaw 2>/dev/null | grep -q "Linger=yes"; then
  echo "[OK] Linger bereits aktiviert"
else
  loginctl enable-linger openclaw
  echo "[OK] Linger aktiviert (Services starten ohne Login)"
fi

# 5. Node.js 24 installieren
if su - openclaw -c "node --version" 2>/dev/null | grep -q "v2[4-9]"; then
  echo "[OK] Node.js $(su - openclaw -c 'node --version') bereits installiert"
else
  echo "[...] Installiere Node.js 24 via fnm"
  su - openclaw -c 'curl -fsSL https://fnm.vercel.app/install | bash'
  su - openclaw -c 'source ~/.bashrc && fnm install 24 && fnm default 24'
  echo "[OK] Node.js 24 installiert"
fi

# 6. npm global Verzeichnis
su - openclaw -c 'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global' 2>/dev/null || true
echo "[OK] npm global prefix konfiguriert"

# 7. Git (sollte schon da sein)
if command -v git &>/dev/null; then
  echo "[OK] Git bereits installiert"
else
  apt-get update -qq && apt-get install -y -qq git
  echo "[OK] Git installiert"
fi

# 8. Build-Essentials (fuer llama.cpp CPU build)
if dpkg -l | grep -q build-essential; then
  echo "[OK] Build-Essentials bereits installiert"
else
  apt-get update -qq && apt-get install -y -qq build-essential cmake
  echo "[OK] Build-Essentials installiert"
fi

# 9. Python3 pip + ffmpeg
if command -v pip3 &>/dev/null && command -v ffmpeg &>/dev/null; then
  echo "[OK] python3-pip + ffmpeg bereits installiert"
else
  apt-get update -qq && apt-get install -y -qq python3-pip python3-venv ffmpeg
  echo "[OK] python3-pip + ffmpeg installiert"
fi

# 10. huggingface-cli (fuer Modell-Downloads von HuggingFace)
if su - openclaw -c "command -v huggingface-cli" &>/dev/null; then
  echo "[OK] huggingface-cli bereits installiert"
else
  echo "[...] Installiere huggingface-cli"
  su - openclaw -c 'pip3 install --user "huggingface_hub[cli]"'
  echo "[OK] huggingface-cli installiert"
fi

# 11. uv/uvx (fuer MiniMax MCP-Server)
if su - openclaw -c "command -v uvx" &>/dev/null; then
  echo "[OK] uv/uvx bereits installiert"
else
  echo "[...] Installiere uv/uvx"
  su - openclaw -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
  echo "[OK] uv/uvx installiert"
fi

echo ""
echo "=== Bootstrap abgeschlossen ==="
echo ""
echo "Naechste Schritte (als User 'openclaw'):"
echo "  su - openclaw"
echo "  curl -fsSL https://claude.ai/install.sh | bash"
echo "  claude    # Auth durchfuehren, dann /exit"
echo "  git clone <dein-repo-url> ~/openclaw-deploy"
echo "  cd ~/openclaw-deploy && claude"
echo "  # Dann: /onboard"
