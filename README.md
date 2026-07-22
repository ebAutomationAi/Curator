# Curator — AI Content Curation Pipeline

Pipeline de curación de contenidos self-hosted: comparte una URL por Telegram y en segundos queda archivada en tu biblioteca personal con resumen, categoría y etiquetas generadas por IA.

```
Telegram → Curator Service → Jina Reader → Groq/Gemini → Karakeep → Notificación Telegram
```

## ¿Qué problema resuelve?

Guardar enlaces para leer después genera ruido sin valor: sin resumen, sin contexto, sin búsqueda. Curator convierte cada URL en un bookmark estructurado y buscable, procesado automáticamente en el momento en que lo compartes.

## Stack

| Componente | Tecnología |
|---|---|
| Interfaz de entrada | Telegram Bot (polling / webhook) |
| Extracción de contenido | Jina Reader API |
| Generación de metadatos | Gemini Flash (principal) + Groq (fallback automático) |
| Almacenamiento | Karakeep + Meilisearch |
| Infraestructura | Docker Compose · Orange Pi 5 Max (ARM64) · Ubuntu |
| Proxy / SSL | Nginx Proxy Manager + DuckDNS |

## Características

- Fallback automático Gemini → Groq cuando se agota el cupo diario de la API gratuita
- Log rotation configurado (50 MB máx. para el pipeline principal)
- Arranque automático vía systemd tras reinicio del servidor
- Self-hosted completo: ningún dato sale de tu infraestructura

## Despliegue

Requiere Docker, Docker Compose, y las API keys de Telegram, Jina, Gemini y/o Groq.

```bash
git clone https://github.com/ebAutomationAi/Curator.git
cd Curator
cp .env.example .env   # completar credenciales
docker network create proxy
docker compose up -d
```

---

## Prerrequisitos

```bash
# Requerido: crear la red externa de Docker antes del primer docker compose up
docker network create proxy
```

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

1. En Nginx Proxy Manager (puerto 81), verificar que el Proxy Host `your-subdomain.duckdns.org` apunta a `curator:3001` con SSL activo.

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
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-subdomain.duckdns.org/webhook/telegram"
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

### 📁 Opciones de almacenamiento para backups

El sistema permite guardar backups en tres destinos diferentes. Elige el que mejor se adapte a tu infraestructura:

#### 🔌 Opción 1: Backup en disco local o NAS montado

Recomendado para: Usuarios con disco externo, NAS local o segundo disco en la Orange Pi.

##### Montar un disco externo o NAS

Identificar el disco o recurso de red:

Para **discos USB/externos**, ejecuta `lsblk` o `sudo fdisk -l` para ver el dispositivo (ej: `/dev/sda1`).

Para **NAS**, necesitarás la IP y el path de la carpeta compartida (ej: `//192.168.1.100/backups`).

Crear punto de montaje:

```bash
sudo mkdir -p /mnt/backups/curator
```

Montar el disco o NAS:

**Para disco USB/externo (ext4):**

**Para NAS (CIFS/SMB):**

```bash
sudo apt install cifs-utils  # Instalar soporte para SMB/CIFS
sudo mount -t cifs //192.168.1.100/backups /mnt/backups/curator -o username=tu_usuario,password=tu_contraseña,vers=3.0
```

Configurar montaje automático al arrancar (opcional):

Verificar el montaje:

```bash
df -h | grep curator
```

##### Ejecutar backups en el disco montado

Crear el script de backup (ej: /opt/curator/backup.sh):

```bash
#!/bin/bash
# Script de backup para Curator
# Guardará backups en /mnt/backups/curator/

BACKUP_DIR="/mnt/backups/curator"
DATE=$(date +%Y%m%d_%H%M%S)
REPO_DIR="/opt/curator"

# Crear directorio de backups si no existe
mkdir -p "$BACKUP_DIR"

# Backup de datos de Karakeep (crítico)
tar -czf "$BACKUP_DIR/karakeep-data-$DATE.tar.gz" "$REPO_DIR/karakeep/data"

# Backup del .env (crítico)
cp "$REPO_DIR/.env" "$BACKUP_DIR/.env-$DATE"

# Backup del código (opcional, sin datos sensibles)
tar -czf "$BACKUP_DIR/curator-code-$DATE.tar.gz" \
  --exclude="$REPO_DIR/karakeep/data" \
  --exclude="$REPO_DIR/curator/logs" \
  "$REPO_DIR"

# Eliminar backups antiguos (mantener últimos 7 días)
find "$BACKUP_DIR" -name "*.tar.gz" -type f -mtime +7 -delete
find "$BACKUP_DIR" -name ".env-*" -type f -mtime +7 -delete

# Log
echo "Backup completado en $BACKUP_DIR el $(date)" >> "$BACKUP_DIR/backup_log.txt"
```

Hacer el script ejecutable:

```bash
chmod +x /opt/curator/backup.sh
```

Programar el backup con cron (ej: diariamente a las 2 AM):

```bash
crontab -e
```

Probar el script manualmente:

```bash
/opt/curator/backup.sh
```

#### ☁️ Opción 2: Backup a Amazon S3

Recomendado para: Usuarios con cuenta AWS (gratis durante 12 meses con Free Tier).

##### Requisitos previos

Crear un bucket en S3:

Ve a [AWS S3 Console](https://s3.console.aws.amazon.com/).

Haz clic en **"Crear bucket"** y sigue los pasos (nombre único, región cercana, etc.).

Crear un usuario IAM con permisos para S3:

Ve a [IAM Console](https://console.aws.amazon.com/iam/).

Crea un nuevo usuario (ej: `curator-backup`).

Asigna la política **`AmazonS3FullAccess`** (o restringe a tu bucket específico).

Guarda las credenciales (**Access Key ID** y **Secret Access Key**).

Instalar AWS CLI en la Orange Pi:

```bash
sudo apt update && sudo apt install -y awscli
```

Configurar AWS CLI:

```bash
aws configure
```

**AWS Access Key ID**: Tu clave de acceso.

**AWS Secret Access Key**: Tu clave secreta.

**Default region name**: Ej: `eu-west-1` (o la región de tu bucket).

**Default output format**: `json`.

##### Ejecutar backups en S3

Crear el script de backup (ej: /opt/curator/backup_s3.sh):

```bash
#!/bin/bash
# Script de backup para Curator en Amazon S3

BUCKET_NAME="tu-bucket-curator"  # Cambia por el nombre de tu bucket
DATE=$(date +%Y%m%d_%H%M%S)
REPO_DIR="/opt/curator"
TEMP_DIR="/tmp/curator_backups"

# Crear directorio temporal
mkdir -p "$TEMP_DIR"

# Backup de datos de Karakeep (crítico)
tar -czf "$TEMP_DIR/karakeep-data-$DATE.tar.gz" "$REPO_DIR/karakeep/data"

# Backup del .env (crítico)
cp "$REPO_DIR/.env" "$TEMP_DIR/.env-$DATE"

# Backup del código (opcional, sin datos sensibles)
tar -czf "$TEMP_DIR/curator-code-$DATE.tar.gz" \
  --exclude="$REPO_DIR/karakeep/data" \
  --exclude="$REPO_DIR/curator/logs" \
  "$REPO_DIR"

# Subir a S3
aws s3 cp "$TEMP_DIR/karakeep-data-$DATE.tar.gz" "s3://$BUCKET_NAME/backups/karakeep/"
aws s3 cp "$TEMP_DIR/.env-$DATE" "s3://$BUCKET_NAME/backups/env/"
aws s3 cp "$TEMP_DIR/curator-code-$DATE.tar.gz" "s3://$BUCKET_NAME/backups/code/"

# Limpiar archivos temporales
rm -rf "$TEMP_DIR"

# Log
echo "Backup a S3 completado el $(date)" >> /var/log/curator_backup.log
```

Hacer el script ejecutable:

```bash
chmod +x /opt/curator/backup_s3.sh
```

Programar el backup con cron (ej: diariamente a las 2 AM):

```bash
crontab -e
```

Probar el script manualmente:

```bash
/opt/curator/backup_s3.sh
```

Verificar en S3:

Ve a [AWS S3 Console](https://s3.console.aws.amazon.com/) y comprueba que los archivos aparecen en tu bucket.

#### 🐳 Opción 3: Backup con volúmenes de Docker

Recomendado para: Usuarios que prefieren gestionar backups directamente con Docker.

##### Crear un volumen para backups

Crear un volumen de Docker para almacenar backups:

```bash
docker volume create curator_backups
```

Verificar el volumen:

```bash
docker volume inspect curator_backups
```

##### Ejecutar backups usando el volumen

Crear un contenedor temporal para hacer backups:

```bash
# Backup de Karakeep (datos)
docker run --rm \
  -v karakeep_data:/from \
  -v curator_backups:/backups \
  alpine tar -czf /backups/karakeep-data-$(date +%Y%m%d_%H%M%S).tar.gz -C /from .

# Backup del .env (requiere montar el directorio del proyecto)
docker run --rm \
  -v /opt/curator/.env:/from/.env \
  -v curator_backups:/backups \
  alpine cp /from/.env /backups/.env-$(date +%Y%m%d_%H%M%S)

# Backup del código (sin datos sensibles)
docker run --rm \
  -v /opt/curator:/from \
  -v curator_backups:/backups \
  alpine tar -czf /backups/curator-code-$(date +%Y%m%d_%H%M%S).tar.gz \
    --exclude=/from/karakeep/data \
    --exclude=/from/curator/logs \
    -C /from .
```

Automatizar con un script (ej: /opt/curator/backup_docker_volumes.sh):

```bash
#!/bin/bash
# Script de backup usando volúmenes de Docker

DATE=$(date +%Y%m%d_%H%M%S)

# Backup de Karakeep (datos)
docker run --rm \
  -v karakeep_data:/from \
  -v curator_backups:/backups \
  alpine tar -czf /backups/karakeep-data-$DATE.tar.gz -C /from .

# Backup del .env
docker run --rm \
  -v /opt/curator/.env:/from/.env \
  -v curator_backups:/backups \
  alpine cp /from/.env /backups/.env-$DATE

# Backup del código
docker run --rm \
  -v /opt/curator:/from \
  -v curator_backups:/backups \
  alpine tar -czf /backups/curator-code-$DATE.tar.gz \
    --exclude=/from/karakeep/data \
    --exclude=/from/curator/logs \
    -C /from .

# Eliminar backups antiguos (mantener últimos 7 días)
docker run --rm -v curator_backups:/backups alpine \
  find /backups -name "*.tar.gz" -type f -mtime +7 -delete
docker run --rm -v curator_backups:/backups alpine \
  find /backups -name ".env-*" -type f -mtime +7 -delete

# Log
docker run --rm -v curator_backups:/backups alpine \
  sh -c 'echo "Backup con Docker Volumes completado el $(date)" >> /backups/backup_log.txt'
```

Hacer el script ejecutable:

```bash
chmod +x /opt/curator/backup_docker_volumes.sh
```

Programar el backup con cron (ej: diariamente a las 2 AM):

```bash
crontab -e
```

Probar el script manualmente:

```bash
/opt/curator/backup_docker_volumes.sh
```

Verificar los backups en el volumen:

```bash
docker run --rm -v curator_backups:/backups alpine ls -la /backups
```

##### Restaurar desde el volumen de Docker

Parar los servicios:

```bash
cd /opt/curator && docker compose down
```

Restaurar los datos de Karakeep:

```bash
docker run --rm \
  -v curator_backups:/backups \
  -v /opt/curator/karakeep/data:/to \
  alpine tar -xzf /backups/karakeep-data-YYYYMMDD_HHMMSS.tar.gz -C /to
```

Restaurar el .env:

```bash
docker run --rm \
  -v curator_backups:/backups \
  -v /opt/curator:/to \
  alpine cp /backups/.env-YYYYMMDD_HHMMSS /to/.env
```

Arrancar los servicios:

```bash
docker compose up -d
```

---

## Restaurar desde cualquier método de backup

### 🔄 Restauración general

Parar todos los servicios:

```bash
cd /opt/curator && docker compose down
```

Restaurar los datos según el método usado:

**Desde disco/NAS:**

**Desde S3:**

```bash
aws s3 cp s3://tu-bucket/backups/karakeep/karakeep-data-YYYYMMDD.tar.gz /tmp/
tar -xzf /tmp/karakeep-data-YYYYMMDD.tar.gz -C /
aws s3 cp s3://tu-bucket/backups/env/.env-YYYYMMDD /opt/curator/.env
```

**Desde volumen de Docker:**

```bash
docker run --rm -v curator_backups:/backups alpine tar -xzf /backups/karakeep-data-YYYYMMDD.tar.gz -C /opt/curator/karakeep/data
docker run --rm -v curator_backups:/backups alpine cp /backups/.env-YYYYMMDD /opt/curator/.env
```

Arrancar los servicios:

```bash
docker compose up -d
```

Verificar que todo funciona:

```bash
docker compose logs -f curator
```

---

## Actualizar Karakeep

Parar los servicios:

```bash
cd /opt/curator && docker compose down
```

Hacer backup de los datos (ver sección anterior).

Actualizar la imagen:

```bash
docker compose pull karakeep
```

Arrancar:

```bash
docker compose up -d
```

Verificar en los logs que Karakeep arranca correctamente:

```bash
docker compose logs -f karakeep
```

La versión de Karakeep se controla con la variable KARAKEEP_VERSION en .env
(por defecto usa release, es decir, siempre la última versión estable).

---

## Referencia rápida de archivos

| Ruta | Descripción |
|---|---|
| /opt/curator/.env | Variables de entorno y credenciales |
| /opt/curator/docker-compose.yml | Definición de servicios |
| /opt/curator/curator/src/index.js | Código del pipeline |
| /opt/curator/karakeep/data/ | Datos persistentes de Karakeep |
| /opt/curator/curator/logs/ | Logs de aplicación |
| /opt/curator/CURATOR_PROJECT_REFERENCE.md | Especificación técnica completa |
