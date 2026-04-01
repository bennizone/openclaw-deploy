# Entscheidungen: OpenClaw-Skills

## 2026-03-27 — HA Cloud STT/TTS statt lokal

**Kontext:** Voice-Nachrichten brauchen Speech-to-Text und Text-to-Speech.

**Entscheidung:** HA Cloud STT + TTS (KatjaNeural). OGG/Opus direkt akzeptiert,
keine Konvertierung fuer Input noetig. Output: MP3 → ffmpeg → OGG/Opus fuer WhatsApp.

**Alternativen verworfen:**
- Lokales Whisper — zu langsam auf CPU, braucht GPU-VRAM
- Piper TTS — KatjaNeural klingt natuerlicher

## 2026-03-27 — CJK Sanitizer als Post-Processing

**Kontext:** MiniMax hat "Language Bleeding" — antwortet teilweise mit chinesischen Zeichen.

**Entscheidung:** Doppelte Absicherung: Prompt-Anweisung + before_message_write Hook.
Chinesische Ziffern → arabisch, restliche CJK gestripped. SYNC-Hook (wichtig!).

**Alternativen verworfen:**
- Nur Prompt-Anweisung — MiniMax ignoriert das teilweise

## 2026-03-27 — before_model_resolve statt before_dispatch fuer Routing

**Kontext:** Smart Home Routing muss bei allen Eingangs-Pfaden funktionieren.

**Entscheidung:** `before_model_resolve` Hook. `before_dispatch` feuert NICHT fuer
chatCompletions (HA Assist Pfad), deshalb unbrauchbar.

**Alternativen verworfen:**
- before_dispatch — feuert nicht fuer chatCompletions

## 2026-03-27 — saveMediaBuffer statt /tmp/

**Kontext:** TTS-Audio muss als Voice-Nachricht zurueckgeschickt werden.

**Entscheidung:** `api.runtime.channel.media.saveMediaBuffer()` statt Datei in `/tmp/`.
OpenClaw Media Path Security verhindert `/tmp/` Zugriff.

**Alternativen verworfen:**
- /tmp/ Dateien — blockiert durch Security

## 2026-03-28 — Bootstrap-Anweisungen in SOUL.md

**Kontext:** Kritische Agent-Anweisungen wurden in separaten Dateien platziert,
die nach dem System-Prompt geladen werden.

**Entscheidung:** Alle kritischen Anweisungen MUESSEN in SOUL.md stehen.
MiniMax ignoriert spaeter injizierte Dateien zuverlaessig.

**Alternativen verworfen:**
- Separate Dateien — MiniMax ignoriert sie nach dem initialen System-Prompt
