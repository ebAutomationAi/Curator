#!/bin/bash
# Script de backup para Curator
# Guardará backups en /mnt/backups/curator/ (monta un disco externo o NAS aquí)

# Configuración
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
echo "Backup completado en $BACKUP_DIR" >> "$BACKUP_DIR/backup_log.txt"
