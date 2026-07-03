# CURATOR — Guía de mantenimiento

Sistema de curación de contenidos: el usuario comparte URLs por Telegram y el sistema las archiva en Karakeep con metadatos generados por IA.

```
Telegram → Curator Service → Jina Reader → Groq/Gemini → Karakeep → Notificación Telegram
```

Directorio del proyecto: `/opt/curator`  
Zona horaria: `Europe/Madrid`

---

## Arrancar y parar el sistema

```bash
# Arrancar todos los servicios
cd /opt/curator
docker compose up -d

# Parar todos los servicios
docker compose down

# Reiniciar un servicio concreto
docker compose restart curator

# Ver estado de todos los servicios
docker compose ps
```

### Arranque automático tras reinicio

Todos los contenedores usan `restart: unless-stopped`. El daemon de Docker arranca con el sistema via systemd, por lo que los contenedores se levantan solos tras un reinicio de la Orange Pi — sin configuración adicional necesaria.

Para verificar que Docker arranca con el sistema:
```bash
systemctl is-enabled docker   # debe devolver "enabled"
```

---

## Ver logs

```bash
# Logs en tiempo real del pipeline (el más útil)
docker compose logs -f curator

# Últimas 50 líneas de un servicio
docker compose logs --tail=50 karakeep

# Todos los servicios a la vez
docker compose logs -f
```

Los logs rotan automáticamente (configurado en `docker-compose.yml`):
- `curator`: máximo 5 archivos × 10 MB = 50 MB
- `karakeep`: máximo 3 archivos × 10 MB = 30 MB
- `meilisearch`, `chrome`: máximo 3 archivos × 5 MB = 15 MB cada uno

---

## Actualizar variables de entorno (.env)

1. Editar el archivo `.env`:
   ```bash
   nano /opt/curator/.env
   ```

2. Recrear el contenedor afectado (restart **no** recarga `.env`):
   ```bash
   docker compose up -d --force-recreate curator
   ```

> **Importante:** no usar comentarios en la misma línea que un valor.
> ```bash
> # MAL
> GROQ_API_KEY=mi_clave   # esto se incluye en el valor
>
> # BIEN
> # comentario en línea separada
> GROQ_API_KEY=mi_clave
> ```

---

## Desactivar TELEGRAM_POLLING (activar modo webhook)

El modo polling está activo temporalmente (`TELEGRAM_POLLING=true` en `.env`).  
Cuando el DNS propague y NPM apunte a `curator:3001`, cambiar a webhook:

1. En Nginx Proxy Manager (puerto 81), verificar que el Proxy Host `curator-kiko.duckdns.org` apunta a `curator:3001` con SSL activo.

2. Editar `.env` y eliminar o comentar la línea:
   ```bash
   # TELEGRAM_POLLING=true   ← comentar o borrar esta línea
   ```

3. Recrear el contenedor:
   ```bash
   docker compose up -d --force-recreate curator
   ```

4. Registrar el webhook con Telegram:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://curator-kiko.duckdns.org/webhook/telegram"
   ```

5. Verificar que el webhook está activo:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
   ```

---

## Qué hacer si Gemini da error 429

El error 429 significa que el cupo gratuito diario de Gemini está agotado. El pipeline ya tiene fallback automático a Groq — no es necesario hacer nada.

El cupo de Gemini Free Tier se renueva cada día (medianoche hora del Pacífico, ~09:00 hora de Madrid). Al día siguiente Gemini volverá a funcionar como motor principal automáticamente.

Si Groq también falla, el bookmark se guarda en Karakeep con `resumen = "Sin procesar"` y se recibe una notificación ❌ en Telegram.

---

## Backup y restauración

### Hacer backup

Los datos importantes están en dos directorios:

```bash
# Backup de Karakeep (bookmarks, usuarios, configuración)
tar -czf /tmp/karakeep-backup-$(date +%Y%m%d).tar.gz /opt/curator/karakeep/data

# Backup del proyecto completo (incluye .env y código)
tar -czf /tmp/curator-backup-$(date +%Y%m%d).tar.gz \
  --exclude=/opt/curator/karakeep/data \
  /opt/curator
```

Copiar los archivos `.tar.gz` a un lugar seguro (NAS, nube, otro equipo).

### Restaurar

1. Parar los servicios:
   ```bash
   cd /opt/curator && docker compose down
   ```

2. Restaurar los datos:
   ```bash
   tar -xzf karakeep-backup-YYYYMMDD.tar.gz -C /
   ```

3. Arrancar:
   ```bash
   docker compose up -d
   ```

---

## Actualizar Karakeep

1. Parar los servicios:
   ```bash
   cd /opt/curator && docker compose down
   ```

2. Hacer backup de los datos (ver sección anterior).

3. Actualizar la imagen:
   ```bash
   docker compose pull karakeep
   ```

4. Arrancar:
   ```bash
   docker compose up -d
   ```

5. Verificar en los logs que Karakeep arranca correctamente:
   ```bash
   docker compose logs -f karakeep
   ```

> La versión de Karakeep se controla con la variable `KARAKEEP_VERSION` en `.env`  
> (por defecto usa `release`, es decir, siempre la última versión estable).

---

## Referencia rápida de archivos

| Ruta | Descripción |
|---|---|
| `/opt/curator/.env` | Variables de entorno y credenciales |
| `/opt/curator/docker-compose.yml` | Definición de servicios |
| `/opt/curator/curator/src/index.js` | Código del pipeline |
| `/opt/curator/karakeep/data/` | Datos persistentes de Karakeep |
| `/opt/curator/curator/logs/` | Logs de aplicación |
| `/opt/curator/CURATOR_PROJECT_REFERENCE.md` | Especificación técnica completa |
