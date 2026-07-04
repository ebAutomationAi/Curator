# CURATOR — Documento de Referencia del Proyecto
**Versión:** 1.4 — Mayo 2026
**Estado:** Proyecto completo — todas las fases validadas (Fases 0–4)
**Rol humano:** Orquestador/Arquitecto
**Agente ejecutor:** Claude Code

---

## ⚠️ INSTRUCCIONES PARA EL AGENTE

Este documento es la fuente de verdad del proyecto. Antes de ejecutar cualquier tarea:
1. Lee este documento completo
2. No tomes decisiones de arquitectura no contempladas aquí sin consultar al orquestador
3. Si encuentras un conflicto o ambigüedad, detente e informa
4. Documenta cualquier desviación respecto a lo especificado

---

## 1. Descripción del sistema

Sistema de curación inteligente de contenidos. El usuario comparte enlaces desde el móvil vía Telegram. El sistema extrae el contenido, lo procesa con IA y lo archiva en Karakeep con metadatos estructurados. El usuario recibe confirmación en Telegram.

**Pipeline completo:**
```
[Móvil] → Telegram Bot
             ↓ webhook HTTPS
         Curator Service (Docker, Orange Pi)
             ↓ HTTP GET
         Jina Reader (r.jina.ai)
             ↓ texto limpio
         Gemini API (Free Tier) → JSON estructurado
             ↓
         Karakeep API → bookmark creado
             ↓
         Telegram Bot → notificación al usuario
```

---

## 2. Infraestructura del host

| Parámetro | Valor |
|---|---|
| Hardware | Orange Pi 5 Max |
| OS | Linux (ARM64) |
| Usuario del sistema | `kiko` |
| Timezone | `Europe/Madrid` |
| Runtime | Docker + Docker Compose |
| Reverse proxy | Nginx Proxy Manager (contenedor `npm`) |
| Red Docker para proxiado | `proxy` |
| Dominio público | `curator-kiko.duckdns.org` |
| DNS dinámico | DuckDNS (contenedor ya configurado) |
| Directorio del proyecto | `/opt/curator` |

---

## 3. Servicios externos

| Servicio | Uso | Credencial | Notas |
|---|---|---|---|
| Telegram Bot API | Captura + notificaciones | `BOT_TOKEN` (en .env) | Crear con BotFather |
| Jina Reader | Extracción de contenido | Sin API key | `https://r.jina.ai/{url}` |
| Gemini API | Procesado IA | `GEMINI_API_KEY` (en .env) | Free Tier, Google AI Studio |
| Groq API | Fallback de IA | `GROQ_API_KEY` (en .env) | Activar si Gemini falla |

---

## 4. Servicios Docker del proyecto

### 4.1 Karakeep
| Parámetro | Valor |
|---|---|
| Imagen | `ghcr.io/karakeep-app/karakeep:release` |
| Puerto interno | `3000` |
| Dominio interno (NPM) | `karakeep.curator-kiko.duckdns.org` |
| Volumen de datos | `/opt/curator/karakeep/data` |
| Red | `proxy` |

### 4.2 Curator Service
Servicio propio que orquesta el pipeline. **Stack elegido: Node.js 20 + Fastify.**

Justificación: compatibilidad ARM64 con imagen oficial `node:20-alpine` (~50 MB), `fetch` nativo en Node 20 (sin dependencias extra), modelo async/await ideal para el pipeline de I/O (Jina → Gemini → Karakeep), y Fastify como framework ligero con JSON parsing y logging integrados.

| Parámetro | Valor |
|---|---|
| Runtime | Node.js 20 + Fastify |
| Imagen base | `node:20-alpine` |
| Puerto interno | `3001` |
| Endpoint webhook | `POST /webhook/telegram` |
| Endpoint salud | `GET /health` |
| Dominio público (NPM) | `curator-kiko.duckdns.org` |
| Volumen de logs | `/opt/curator/curator/logs` |
| Red | `proxy` |

---

## 5. Estructura de directorios

```
/opt/curator/
├── docker-compose.yml          ← define todos los servicios
├── .env                        ← variables de entorno (nunca en git)
├── .env.example                ← plantilla sin valores reales
├── karakeep/
│   └── data/                   ← datos persistentes de Karakeep
└── curator/
    ├── src/                    ← código fuente del servicio
    ├── logs/                   ← logs de ejecución
    └── Dockerfile              ← imagen del servicio
```

---

## 6. Variables de entorno (.env)

```bash
# Telegram
BOT_TOKEN=                      # Token del bot (BotFather)
TELEGRAM_CHAT_ID=               # Chat ID del usuario (para notificaciones)

# IA — Primario
GEMINI_API_KEY=                 # Ya disponible

# IA — Fallback
GROQ_API_KEY=                   # Opcional, para fallback

# Karakeep
KARAKEEP_API_KEY=               # Generado tras primer arranque de Karakeep
KARAKEEP_URL=http://karakeep:3000

# Servicio
NODE_ENV=production
TZ=Europe/Madrid

# Temporal — polling mientras el webhook HTTPS no esté activo
TELEGRAM_POLLING=true
```

> **`TELEGRAM_POLLING`** es temporal. Eliminar cuando DNS propague y NPM apunte a `curator:3001`, luego registrar el webhook con `setWebhook` (ver README.md).

---

## 7. Esquema JSON que produce la IA

La IA debe devolver **exclusivamente** este JSON. Cualquier campo faltante o formato incorrecto debe ser tratado como error por el servicio.

```json
{
  "titulo": "string — máx 80 caracteres",
  "tipo": "articulo | video | hilo | podcast | otro",
  "categoria": "tecnologia | ciencia | negocios | cultura | educacion | salud | otra",
  "resumen": "string — 2 a 3 frases en español",
  "puntos_clave": ["string", "string", "string"],
  "prioridad": "número entero 1-5 (5 = máxima relevancia)",
  "etiquetas": ["string", "string", "string"]
}
```

---

## 8. Lógica de fallback

El servicio debe implementar esta cadena de decisiones:

```
1. Jina Reader extrae contenido
   ├── OK  → pasa texto a IA
   └── FAIL → pasa solo título+URL a IA con instrucción "resume con lo disponible"

2. Gemini procesa
   ├── OK  → continúa
   └── FAIL → intenta con Groq
               ├── OK  → continúa
               └── FAIL → guarda en Karakeep con resumen="Sin procesar"
                          notifica al usuario con ❌

3. Karakeep API crea bookmark
   ├── OK  → notifica ✅ al usuario
   └── FAIL → loguea error, notifica ❌ al usuario con motivo
```

---

## 9. Formato de notificaciones Telegram

**Éxito:**
```
✅ Guardado
📌 {titulo}
📂 {categoria} · {tipo} · prioridad {prioridad}/5
🏷 {etiqueta1}, {etiqueta2}, {etiqueta3}
```

**Éxito con extracción parcial:**
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

---

## 10. Configuración de Nginx Proxy Manager

El agente **no configura NPM directamente**. Tras levantar los contenedores, el orquestador configura manualmente en la UI de NPM (puerto 81):

**Proxy Host 1 — Karakeep:**
- Domain: `karakeep.curator-kiko.duckdns.org`
- Forward Hostname: `karakeep`
- Forward Port: `3000`
- SSL: Let's Encrypt (forzar HTTPS)

**Proxy Host 2 — Curator Service (webhook):**
- Domain: `curator-kiko.duckdns.org`
- Forward Hostname: `curator`
- Forward Port: `3001`
- SSL: Let's Encrypt (forzar HTTPS)

---

## 11. Fases del proyecto y estado

```
✅ FASE 0 — Fundaciones
   ✅ Arquitectura definida
   ✅ Documento de referencia redactado
   ✅ Stack tecnológico fijado

✅ FASE 1 — Infraestructura base
   ✅ Tarea 1.1: docker-compose.yml + Karakeep funcionando
   ✅ Tarea 1.2: Telegram Bot creado (@CuratorkikoBot)
   ✅ Tarea 1.3: Gemini API key verificada

✅ FASE 2 — Pipeline core
   ✅ Tarea 2.1: Webhook recibe URL y la loguea
   ✅ Tarea 2.2: URL → Jina Reader → texto limpio
   ✅ Tarea 2.3: Texto → Gemini → JSON válido (fallo inmediato en 429, fallback Groq)
   ✅ Tarea 2.4: JSON → Karakeep API → bookmark creado (título, nota, etiquetas)

✅ FASE 3 — Cierre del loop
   ✅ Tarea 3.1: Notificaciones Telegram (✅ éxito, ⚠️ parcial, ❌ error)
   ✅ Tarea 3.2: Lógica de fallback completa (Jina → Gemini → Groq → Sin procesar)
   ✅ Tarea 3.3: Pruebas con enlaces reales validadas

✅ FASE 4 — Hardening
   ✅ Tarea 4.1: Arranque automático (restart: unless-stopped + Docker en systemd)
   ✅ Tarea 4.2: Rotación de logs configurada en docker-compose.yml
   ✅ Tarea 4.3: README.md de mantenimiento creado en /opt/curator/README.md
```

---

## 12. Restricciones y límites para el agente

- **No modificar** configuraciones de NPM, DuckDNS ni ningún contenedor existente
- **No exponer** puertos directamente al host salvo que el orquestador lo apruebe explícitamente
- **No almacenar** credenciales fuera del archivo `.env`
- **No avanzar** a la siguiente fase sin validación explícita del orquestador
- **No tomar decisiones** sobre el esquema de datos de Karakeep sin consulta previa
- Todos los contenedores deben usar `restart: unless-stopped`
- Todos los contenedores deben unirse a la red `proxy`

---

## 13. Criterios de validación por fase

### Fase 1 completa cuando:
- `docker compose ps` muestra todos los servicios `Up`
- Karakeep responde en `http://karakeep:3000` desde dentro de la red
- El bot de Telegram responde a `/start`
- Gemini devuelve respuesta a una llamada de prueba

### Fase 2 completa cuando:
- Enviar una URL al bot genera un bookmark en Karakeep en menos de 30 segundos
- El JSON generado por Gemini contiene todos los campos del esquema definido
- Los logs muestran cada paso del pipeline sin errores

### Fase 3 completa cuando:
- El usuario recibe notificación en Telegram para cada enlace procesado
- Un enlace con paywall genera notificación ⚠️ en lugar de ❌
- Un fallo de Gemini activa correctamente el fallback a Groq

### Fase 4 completa cuando:
- Reiniciar la Orange Pi levanta todos los servicios automáticamente
- Los logs rotan y no llenan el disco
- Existe un README de mantenimiento en `/opt/curator/README.md`

---

## 14. Decisiones técnicas implementadas

### Stack del Curator Service
- **Lenguaje/framework:** Node.js 20 + Fastify sobre `node:20-alpine`
- **Razón:** soporte ARM64 oficial, `fetch` nativo (sin dependencias extra), async/await adecuado para pipeline I/O, Fastify ligero con logging JSON integrado (pino)
- **Dependencias npm:** solo `fastify` — todo lo demás usa la stdlib de Node 20

### Variables de entorno temporales activas
| Variable | Valor | Condición de retirada |
|---|---|---|
| `TELEGRAM_POLLING` | `true` | Eliminar cuando DNS propague y NPM apunte a `curator:3001`, luego registrar webhook con `setWebhook` |

### Motor de IA y comportamiento ante 429
Gemini Free Tier tiene cupo diario limitado. Cuando recibe un `429`, el servicio falla inmediatamente (sin espera) y pasa a Groq. Si Groq también falla, guarda el bookmark con `resumen = "Sin procesar"` y notifica ❌.

El retry con espera de 5 s solo se aplica a errores transitorios (`502`, `503`).

El cupo de Gemini se renueve cada día (~09:00 hora de Madrid). Al renovarse, el fallback a Groq deja de activarse sin ningún cambio de código.

### Notificaciones Telegram
Función `sendTelegram(chatId, text)` en `index.js`. Usa el `chat_id` del mensaje entrante; si no está disponible, usa `TELEGRAM_CHAT_ID` del `.env`. Los fallos de envío se loguean como `warn` pero no interrumpen el pipeline.

### Normalización de etiquetas
Las etiquetas generadas por la IA se convierten a minúsculas en dos niveles: el prompt las pide en minúsculas, y el código aplica `.toLowerCase()` sobre cada etiqueta antes de enviarlas a Karakeep. Esto evita duplicados por capitalización inconsistente.

### Rotación de logs Docker
Configurada en `docker-compose.yml` mediante `logging.driver: json-file`:
| Servicio | Tamaño máx por archivo | Archivos | Total máx |
|---|---|---|---|
| `curator` | 10 MB | 5 | 50 MB |
| `karakeep` | 10 MB | 3 | 30 MB |
| `meilisearch` | 5 MB | 3 | 15 MB |
| `chrome` | 5 MB | 3 | 15 MB |

---

## 15. Lecciones operativas

### Recarga de variables de entorno en Docker
`docker compose restart` **no** recarga el `.env` — el contenedor conserva las variables del arranque anterior.
Usar siempre:
```bash
docker compose up -d --force-recreate curator
```

### Comentarios inline en .env
Los comentarios en la misma línea que un valor se incluyen literalmente en la variable:
```bash
# MAL — Docker incluye "# comentario" como parte del valor
GROQ_API_KEY=mi_clave   # comentario

# BIEN — comentario en línea separada
# comentario
GROQ_API_KEY=mi_clave
```
El carácter `—` (U+2014) en un comentario inline provocó un error `ByteString` al construir el header `Authorization` de Groq. El código del servicio sanitiza el valor con `.split(/\s/)[0]` como medida defensiva, pero la práctica correcta es no usar comentarios inline.

---

## 16. Incidencias conocidas

### 16.1 — Karakeep devuelve 401 de forma intermitente o persistente

Causa confirmada: Karakeep requiere el header
"authorization" en minúsculas. Node.js fetch enviaba
"Authorization" con A mayúscula que Karakeep rechazaba
con 401. Solución: cambiar headers en callKarakeep a
minúsculas ('content-type' y 'authorization').
Versión: 1.4

**Workaround:**
```bash
# Forzar recreación del contenedor para releer el .env desde cero
docker compose up -d --force-recreate curator

# Verificar que la key que usa el servicio coincide con la del .env
docker compose exec curator printenv KARAKEEP_API_KEY

# Prueba directa desde la terminal para confirmar que la key es válida
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $(grep KARAKEEP_API_KEY /opt/curator/.env | cut -d= -f2)" \
  http://localhost:3000/api/v1/bookmarks
```

> Ver también la lección operativa de la **sección 15** sobre recarga de variables con `--force-recreate`.

---

### 16.2 — Groq y Gemini devuelven 429 simultáneamente

**Fecha de detección:** 13 mayo 2026

**Síntomas:**
- El pipeline falla en el paso de IA y el bookmark se guarda con `resumen = "Sin procesar"`
- Los logs muestran `429 Too Many Requests` tanto en la llamada a Gemini como en el fallback a Groq
- El usuario recibe notificación `❌` en Telegram

**Causa probable:**
Ambos servicios operan en **Free Tier** con cupos diarios limitados. Durante sesiones de pruebas intensivas en el mismo día se pueden agotar los cupos de ambas APIs en pocas horas. Al fallar Gemini, el fallback activa Groq, que tampoco tiene cupo disponible.

**Workaround:**
- Esperar a que se renueven los cupos:
  - **Gemini:** se renueva cada día aproximadamente a las **09:00 hora de Madrid**
  - **Groq:** se renueva cada día (límite por minuto y por día; los límites diarios se renuevan a medianoche UTC)
- Reducir el número de pruebas realizadas en un mismo día durante el desarrollo
- No hay acción de código necesaria: cuando los cupos se renuevan, el pipeline vuelve a funcionar sin cambios

> La lógica de fallback es correcta y está validada. Este error es operativo, no un bug del servicio.
