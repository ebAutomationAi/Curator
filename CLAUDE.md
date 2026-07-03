# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**CURATOR** is an intelligent content curation pipeline running on an Orange Pi 5 Max (ARM64). The user shares links from their phone via Telegram; the system extracts content, processes it with AI, archives it in Karakeep, and sends a Telegram confirmation.

```
[Mobile] → Telegram Bot → Curator Service (Docker) → Jina Reader → Gemini API → Karakeep API → Telegram notification
```

**Current state:** Phase 0 complete (architecture defined). Phase 1 is next.

## Host environment

- **Hardware:** Orange Pi 5 Max (ARM64)
- **User:** `kiko`
- **Timezone:** `Europe/Madrid`
- **Runtime:** Docker + Docker Compose
- **Reverse proxy:** Nginx Proxy Manager (container `npm`, configured manually via UI on port 81 — the agent never touches NPM)
- **Docker network for proxying:** `proxy`
- **Public domain:** `curator-kiko.duckdns.org`
- **Project directory:** `/opt/curator`

## Common commands

```bash
# Start all services
docker compose up -d

# Check service status
docker compose ps

# View logs for a specific service
docker compose logs -f curator

# Restart a single service
docker compose restart curator

# Stop everything
docker compose down
```

## Directory structure

```
/opt/curator/
├── CLAUDE.md
├── CURATOR_PROJECT_REFERENCE.md   ← full spec, source of truth
├── docker-compose.yml
├── .env                           ← secrets, never in git
├── .env.example
├── karakeep/
│   └── data/                      ← Karakeep persistent data
└── curator/
    ├── src/                       ← Curator service source
    ├── logs/                      ← runtime logs
    └── Dockerfile
```

## Services

### Karakeep (bookmark manager)
- Image: `ghcr.io/karakeep-app/karakeep:release`
- Internal port: `3000`
- NPM domain: `karakeep.curator-kiko.duckdns.org`
- Data volume: `/opt/curator/karakeep/data`

### Curator Service (the pipeline)
- Internal port: `3001`
- Webhook endpoint: `POST /webhook/telegram`
- NPM domain: `curator-kiko.duckdns.org`
- Logs volume: `/opt/curator/curator/logs`

Both containers must use `restart: unless-stopped` and join the `proxy` network.

## Environment variables (.env)

```bash
BOT_TOKEN=           # Telegram bot token (BotFather)
TELEGRAM_CHAT_ID=    # User's chat ID for notifications
GEMINI_API_KEY=      # Primary AI (Google AI Studio, free tier)
GROQ_API_KEY=        # Fallback AI (optional)
KARAKEEP_API_KEY=    # Generated after first Karakeep startup
KARAKEEP_URL=http://karakeep:3000
NODE_ENV=production
TZ=Europe/Madrid
```

## Pipeline logic

### Content extraction
- Primary: `https://r.jina.ai/{url}` (no API key needed)
- On failure: pass only title+URL to AI with instruction to summarize with available info

### AI processing (Gemini → Groq fallback)
The AI must return **exactly** this JSON schema — any missing field or wrong format is an error:

```json
{
  "titulo": "string — max 80 chars",
  "tipo": "articulo | video | hilo | podcast | otro",
  "categoria": "tecnologia | ciencia | negocios | cultura | educacion | salud | otra",
  "resumen": "string — 2-3 sentences in Spanish",
  "puntos_clave": ["string", "string", "string"],
  "prioridad": 1,
  "etiquetas": ["string", "string", "string"]
}
```

`prioridad` is an integer 1–5 (5 = highest relevance).

### Fallback chain
```
Jina OK? → AI (Gemini) OK? → Karakeep OK? → notify ✅
                           ↓ fail
                        Groq OK? → Karakeep → notify ✅
                                 ↓ fail
                              save with resumen="Sin procesar", notify ❌
```

## Telegram notification formats

**Success:**
```
✅ Guardado
📌 {titulo}
📂 {categoria} · {tipo} · prioridad {prioridad}/5
🏷 {etiqueta1}, {etiqueta2}, {etiqueta3}
```

**Partial extraction:**
```
⚠️ Guardado (contenido parcial)
📌 {titulo}
📂 {categoria} · {tipo}
ℹ️ No se pudo extraer el texto completo
```

**Error:**
```
❌ Error al procesar
🔗 {url}
💬 {motivo_breve}
```

## Agent constraints

- **Never** modify NPM, DuckDNS, or any existing containers outside this project
- **Never** expose ports directly to the host without explicit orchestrator approval
- **Never** store credentials outside `.env`
- **Never** advance to the next phase without explicit validation from the orchestrator
- **Never** make decisions about Karakeep's data schema without prior consultation

## Phase validation criteria

**Phase 1 done when:** `docker compose ps` shows all services `Up`; Karakeep responds at `http://karakeep:3000` from inside the network; Telegram bot responds to `/start`; Gemini returns a response to a test call.

**Phase 2 done when:** Sending a URL to the bot creates a Karakeep bookmark in under 30 seconds; Gemini JSON contains all schema fields; logs show each pipeline step without errors.

**Phase 3 done when:** User receives Telegram notification for every processed link; a paywalled link generates ⚠️ instead of ❌; Gemini failure correctly triggers Groq fallback.

**Phase 4 done when:** Rebooting the Orange Pi brings all services up automatically; logs rotate without filling the disk.
