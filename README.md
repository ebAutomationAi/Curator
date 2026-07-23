## `README.md` — Cambios principales

- **Nueva sección**: *Autenticación y recuperación de contraseña* — explica que Karakeep maneja su propio login con "Forgot Password" y que solo requiere configurar SMTP.
- **Actualizado**: *Quick start* — añadido paso de configurar SMTP.
- **Actualizado**: *Tech stack / Infrastructure* — mención de Nginx Proxy Manager y SMTP.

# Curator — AI Content Curation Pipeline

Self-hosted automation pipeline that turns shared Telegram links into AI-categorized, searchable bookmarks in under 30 seconds.

```
Mobile → Telegram Bot → Curator (Node.js/Fastify)
                          ├── Jina Reader (content extraction)
                          ├── Gemini Flash (AI primary)
                          ├── Groq LLaMA 3.3 (automatic fallback)
                          └── Karakeep + Meilisearch (storage + search)
```

## How it works

1. Share any URL to the Telegram bot from your phone
2. Jina Reader extracts the page content (no API key required)
3. Gemini generates structured metadata: title, summary, category, tags, priority
4. If Gemini quota is exhausted (429), Groq takes over automatically
5. Bookmark is saved to Karakeep with all metadata attached
6. Telegram confirms with a direct link to the bookmark

## Autenticación y recuperación de contraseña

Karakeep incluye su propio sistema de autenticación con soporte para **recuperación de contraseña (Forgot Password)** desde la v0.26.0. No requiere modificar código: solo configurar un servidor SMTP en el `.env` para que Karakeep pueda enviar los emails de reset.

Ver [OPERATIONS.md](OPERATIONS.md) para la configuración detallada de SMTP.

## Key technical decisions

**Zero npm dependencies beyond Fastify.** The pipeline uses Node 20's native `fetch`, `AbortController`, and `crypto` — no axios, no SDK wrappers. This keeps the Docker image small and the dependency surface minimal.

**Dual AI fallback with differentiated retry logic.** Gemini 429 (daily quota exhausted) triggers an immediate switchover to Groq — no retry, no delay, because the quota won't recover mid-request. Transient errors (502/503) get one retry with 5s backoff before fallback. The distinction matters: retrying a quota error wastes time; not retrying a transient error wastes a working API call.

**Login wall detection with weighted signal threshold.** Jina Reader sometimes returns a login page instead of content (TikTok, Instagram). A naive string match on "log in" produces false positives on normal articles that mention login. The solution counts standalone-line occurrences (regex anchored to `^` and `$`) and triggers only when the count reaches 2 — the threshold validated against real TikTok responses (4 signals) vs clean articles (0 signals).

**Tag normalization against existing Karakeep state.** Before saving, the pipeline queries the Karakeep tag list and matches incoming tags case-insensitively. This prevents duplicate tags (e.g. "IA" vs "ia" vs "Ia") from fragmenting the tag space over time.

**Non-root container with explicit ownership.** The Dockerfile runs as `USER node` with `chown -R node:node /app`. The healthcheck uses `127.0.0.1` explicitly — Alpine resolves `localhost` to `::1` (IPv6) while Fastify binds IPv4 only, which causes silent healthcheck failures.

**`NEXTAUTH_URL` reuse for Telegram deep links.** The Telegram notification includes an inline button linking directly to the bookmark in Karakeep (`/dashboard/preview/{id}`). Rather than introducing a separate `KARAKEEP_PUBLIC_URL` variable, the pipeline reuses `NEXTAUTH_URL` — the variable Karakeep already requires. One source of truth, zero drift.

## Tech stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20 + Fastify |
| Content extraction | Jina Reader API (no key required) |
| AI — primary | Google Gemini 2.0 Flash |
| AI — fallback | Groq LLaMA 3.3 70B Versatile |
| Storage | Karakeep (SQLite via better-sqlite3) |
| Search | Meilisearch |
| Infrastructure | Docker Compose · ARM64 (Orange Pi 5 Max / RK3588) |
| Reverse proxy | Nginx Proxy Manager + DuckDNS |
| Email | SMTP (Gmail, SendGrid, AWS SES, etc.) |

## Project structure
```
curator/
├── src/
│   ├── index.js         # Fastify server, routes, polling loop
│   ├── pipeline.js      # Main orchestration: Jina → AI → Karakeep → notify
│   ├── extractors.js    # Jina Reader client + login wall detection
│   ├── ai.js            # Gemini and Groq clients, prompt builder, fallback logic
│   ├── karakeep.js      # Karakeep API client, tag normalization
│   ├── telegram.js      # Telegram notifications, inline keyboard builder
│   ├── validation.js    # JSON parsing, schema validation, type constants
│   └── *.test.js        # Tests — Node.js native test runner (no extra deps)
├── Dockerfile           # node:20-alpine, non-root user, IPv4 healthcheck
└── package.json
docker-compose.yml       # Karakeep + Meilisearch + Chrome + Curator
.env.example             # All required variables documented
```

## Quick start

```bash
git clone https://github.com/ebAutomationAi/Curator.git
cd Curator
cp .env.example .env        # fill in your API keys
docker network create proxy
docker compose up -d
```

Requires: Docker, Docker Compose, a Telegram bot token ([@BotFather](https://t.me/BotFather)), and API keys for Gemini and/or Groq.

See [OPERATIONS.md](OPERATIONS.md) for deployment details, backup strategy, and maintenance procedures.

## Running tests

```bash
cd curator && npm test
```

23 tests covering schema validation, login wall detection, URL extraction, and Telegram button generation. Uses Node.js built-in `node:test` — no test framework dependencies.

## License

MIT
