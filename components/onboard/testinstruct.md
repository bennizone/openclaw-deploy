# Test-Anweisungen: Onboard

## Voraussetzungen

- Zugang zu LXC als User `openclaw`
- Repo geklont: `~/openclaw-deploy/`
- Fuer GPU-Tests: SSH-Zugang zum GPU-Server

## Health-Check

```bash
# Pre-Flight Check (identisch mit onboard.md)
echo "=== Pre-Flight ===" \
  && command -v cmake > /dev/null && echo "[OK] cmake" || echo "[FAIL] cmake" \
  && command -v g++ > /dev/null && echo "[OK] g++" || echo "[FAIL] g++" \
  && command -v pip3 > /dev/null && echo "[OK] pip3" || echo "[FAIL] pip3" \
  && command -v ffmpeg > /dev/null && echo "[OK] ffmpeg" || echo "[FAIL] ffmpeg" \
  && command -v git > /dev/null && echo "[OK] git" || echo "[FAIL] git" \
  && node --version 2>/dev/null && echo "[OK] node" || echo "[FAIL] node" \
  && command -v huggingface-cli > /dev/null && echo "[OK] huggingface-cli" || echo "[FAIL] huggingface-cli" \
  && loginctl show-user openclaw 2>/dev/null | grep -q "Linger=yes" && echo "[OK] linger" || echo "[FAIL] linger"
```

## Funktions-Tests

### Test: State-Datei
```bash
cat ~/.openclaw-deploy-state.json | jq .
```
- Erwartetes Ergebnis: Valides JSON mit phases + config
- Bei Fehler: State-Datei fehlt oder korrupt → neu erstellen lassen

### Test: Bootstrap-Script (idempotent)
```bash
sudo bash setup/lxc/bootstrap.sh
```
- Erwartetes Ergebnis: Alle "[OK]" Meldungen, kein "[FAIL]"
- Idempotent: Kann mehrfach ausgefuehrt werden ohne Schaden

### Test: Node.js Version
```bash
node --version
```
- Erwartetes Ergebnis: v24.x
- Bei Fehler: fnm installieren, `fnm install 24 && fnm default 24`

### Test: OpenClaw CLI
```bash
openclaw --version
```
- Erwartetes Ergebnis: Version >= 2026.3.24
- Bei Fehler: `bash setup/lxc/install-openclaw.sh`

### Test: Linger aktiv
```bash
loginctl show-user openclaw | grep Linger
```
- Erwartetes Ergebnis: `Linger=yes`
- Bei Fehler: `sudo loginctl enable-linger openclaw`

### Test: systemd Services
```bash
systemctl --user status openclaw-gateway openclaw-extractor
```
- Erwartetes Ergebnis: Beide active (running)
- Bei Fehler: Service-Files pruefen, `systemctl --user daemon-reload`

## Integrations-Tests

### Test: GPU-Server erreichbar
```bash
ssh <GPU_USER>@<GPU_SERVER_IP> nvidia-smi
```
- Erwartung: GPU-Info wird angezeigt
- Bei Fehler: SSH-Key kopiert? Firewall?

### Test: End-to-End nach Onboarding
Alle Health-Checks der anderen Komponenten durchlaufen:
1. Gateway: `curl -s http://localhost:18789/health`
2. Qdrant: `curl -s http://localhost:6333/collections`
3. GPU Chat: `curl -s http://<GPU_IP>:8080/health`
4. GPU Embed: `curl -s http://<GPU_IP>:8081/health`
5. chatCompletions: Test-Request an Gateway
