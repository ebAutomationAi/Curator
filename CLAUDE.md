# CLAUDE.md

Este archivo proporciona orientación a Claude Code (claude.ai/code) al trabajar con el código en este repositorio.

## Descripción general del proyecto

**CURATOR** es un pipeline inteligente de curación de contenidos que se ejecuta en una Orange Pi 5 Max (ARM64). El usuario comparte enlaces desde su móvil vía Telegram; el sistema extrae el contenido, lo procesa con IA, lo archiva en Karakeep y envía una confirmación por Telegram.

[Móvil] → Telegram Bot → Curator Service (Docker) → Jina Reader → Gemini API → Karakeep API → Notificación de Telegram


**Estado actual:** Proyecto completo — todas las fases validadas (Fases 0–4).

## Entorno del host

- **Hardware:** Orange Pi 5 Max (ARM64)
- **Usuario:** `kiko`
- **Zona horaria:** `Europe/Madrid`
- **Runtime:** Docker + Docker Compose
- **Proxy inverso:** Nginx Proxy Manager (contenedor `npm`, configurado manualmente mediante la interfaz de usuario en el puerto 81 — el agente nunca toca NPM)
- **Red Docker para proxiado:** `proxy`
- **Dominio público:** `curator-kiko.duckdns.org`
- **Directorio del proyecto:** `/opt/curator`

## Comandos comunes

```bash
# Iniciar todos los servicios
docker compose up -d

# Forzar la recreación para recargar el archivo .env por completo (imprescindible para cambios en .env)
docker compose up -d --force-recreate curator

# Verificar el estado de los servicios
docker compose ps

# Ver logs en tiempo real de un servicio específico
docker compose logs -f curator

# Reiniciar un solo servicio (nota: esto NO recarga cambios del archivo .env)
docker compose restart curator

# Detener todos los servicios
docker compose down

# Verificar las variables de entorno activas dentro del contenedor
docker compose exec curator printenv KARAKEEP_API_KEY
Estructura de directorios
/opt/curator/
├── CLAUDE.md
├── CURATOR_PROJECT_REFERENCE.md   ← Especificación completa, fuente de verdad
├── docker-compose.yml
├── .env                           ← Secretos, nunca en git (¡Prohibidos los comentarios inline!)
├── .env.example
├── karakeep/
│   └── data/                      ← Datos persistentes de Karakeep
└── curator/
    ├── src/                       ← Código fuente del servicio Curator (Node.js + Fastify)
    ├── logs/                      ← Logs de ejecución del servicio
    └── Dockerfile                 ← Imagen basada en node:20-alpine
Servicios
Karakeep (Gestor de marcadores)
Imagen: ghcr.io/karakeep-app/karakeep:release

Puerto interno: 3000

Dominio NPM: karakeep.curator-kiko.duckdns.org

Volumen de datos: /opt/curator/karakeep/data

Nota crítica de integración: Requiere obligatoriamente que los headers content-type y authorization se envíen estrictamente en minúsculas para evitar errores 401 intermitentes.

Curator Service (El pipeline)
Puerto interno: 3001

Endpoint del webhook: POST /webhook/telegram

Dominio NPM: curator-kiko.duckdns.org

Volumen de logs: /opt/curator/curator/logs

Stack: Node.js 20 + Fastify. Única dependencia npm: fastify (aprovecha el fetch nativo de Node 20).

Ambos contenedores deben usar restart: unless-stopped y unirse a la red proxy.

Variables de entorno (.env)
Importante: Está prohibido colocar comentarios en la misma línea que un valor (comentarios inline), ya que Docker o los intérpretes pueden incluir el comentario y caracteres especiales como parte de la cadena de texto de la credencial.

Bash
BOT_TOKEN=            # Token del bot de Telegram (BotFather)
TELEGRAM_CHAT_ID=     # ID de chat del usuario para notificaciones
GEMINI_API_KEY=       # IA primaria (Google AI Studio, free tier)
GROQ_API_KEY=         # IA de fallback (opcional)
KARAKEEP_API_KEY=     # Generada tras el primer arranque de Karakeep
KARAKEEP_URL=http://karakeep:3000
NODE_ENV=production
TZ=Europe/Madrid
TELEGRAM_POLLING=true # Activo temporalmente si el webhook HTTPS no está registrado
Lógica del pipeline
Extracción de contenido
Principal: https://r.jina.ai/{url} (sin necesidad de API key).

Si falla: Pasa únicamente el título + URL a la IA con la instrucción explícita "resume con lo disponible".

Procesamiento de IA (Fallback Gemini → Groq)
La IA debe devolver exclusivamente este esquema JSON; cualquier campo faltante o formato incorrecto se trata como un error crítico del pipeline:

JSON
{
  "titulo": "string — máx 80 caracteres",
  "tipo": "articulo | video | hilo | podcast | otro",
  "categoria": "tecnologia | ciencia | negocios | cultura | educacion | salud | otra",
  "resumen": "string — 2 a 3 frases en español",
  "puntos_clave": ["string", "string", "string"],
  "prioridad": 1,
  "etiquetas": ["string", "string", "string"]
}
prioridad es un número entero del 1 al 5 (5 = máxima relevancia). Las etiquetas generadas siempre se normalizan a minúsculas mediante código (.toLowerCase()) antes de enviarse a Karakeep.

Cadena de fallback ante errores
¿Jina OK? → IA (Gemini) OK? → Karakeep OK? → Notificar ✅
             ↓ falla (e.g. 429)
          ¿Groq OK? → Karakeep → Notificar ✅
             ↓ falla (ambos sin cupo)
          Guardar con resumen="Sin procesar", Notificar ❌
Comportamiento ante 429: Ante un error 429 Too Many Requests en Gemini Free Tier, el servicio conmuta inmediatamente a Groq sin esperas. Los reintentos con retraso de 5s quedan reservados exclusivamente para errores transitorios (502, 503). Los cupos diarios se restablecen sobre las 09:00 hora de Madrid (Gemini) y a medianoche UTC (Groq).

Formatos de notificación de Telegram
Éxito:

✅ Guardado
📌 {titulo}
📂 {categoria} · {tipo} · prioridad {prioridad}/5
🏷 {etiqueta1}, {etiqueta2}, {etiqueta3}
Extracción parcial (Paywalls / Errores de Jina):

⚠️ Guardado (contenido parcial)
📌 {titulo}
📂 {categoria} · {tipo}
ℹ️ No se pudo extraer el texto completo
Error:

❌ Error al procesar
🔗 {url}
💬 {motivo_breve}
Restricciones del agente
Nunca modificar ni alterar configuraciones de NPM, DuckDNS o contenedores ajenos al proyecto.

Nunca exponer puertos directamente al host sin aprobación explícita del orquestador.

Nunca almacenar credenciales o secretos fuera del archivo .env.

Todos los contenedores del stack deben configurarse con restart: unless-stopped y pertenecer a la red proxy.

Criterios de validación (Fases de desarrollo completadas)
Fase 1 (Infraestructura): Todos los contenedores estables en Up. Karakeep operativo internamente y el bot responde a comandos iniciales.

Fase 2 (Pipeline Core): Flujo completo de almacenamiento en menos de 30 segundos. Formato JSON estrictamente validado.

Fase 3 (Cierre del Loop): Notificaciones móviles completamente funcionales diferenciando estados (✅, ⚠️, ❌) y fallback automatizado a Groq verificado.

Fase 4 (Hardening): Persistencia total tras reinicio físico de la Orange Pi. Rotación de logs Docker configurada en docker-compose.yml (json-file, máximo 10MB/5 archivos para curator, 10MB/3 archivos para karakeep). README de mantenimiento presente en /opt/curator/README.md.
