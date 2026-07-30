# Operación interna de Bytewall

Guía para instalar, publicar y mantener Bytewall en un servidor de la red
interna. Para el uso diario de la aplicación vea el [README](../README.md).

## Índice

1. [Qué necesita el servidor](#1-qué-necesita-el-servidor)
2. [Instalación](#2-instalación)
3. [Configuración](#3-configuración)
4. [Correr como servicio](#4-correr-como-servicio)
5. [HTTPS con proxy inverso](#5-https-con-proxy-inverso)
6. [Con Docker](#6-con-docker)
7. [Cuentas desde la terminal](#7-cuentas-desde-la-terminal)
8. [Respaldos y restauración](#8-respaldos-y-restauración)
9. [Monitoreo y bitácora](#9-monitoreo-y-bitácora)
10. [Actualizar a una versión nueva](#10-actualizar-a-una-versión-nueva)
11. [Problemas frecuentes](#11-problemas-frecuentes)

---

## 1. Qué necesita el servidor

| | Mínimo | Comentario |
|---|---|---|
| Sistema | Linux, Windows o macOS | Probado en Linux con Node 22 |
| Node.js | 20 (recomendado 22) | `node --version` |
| RAM | 512 MB | El proceso usa ~80 MB |
| Disco | 1 GB + evidencias | Las evidencias son lo que crece |
| Red | Puerto interno (3000) | Publique 443 por el proxy |

No hace falta servidor de base de datos: SQLite es un archivo. Para un equipo
de decenas de personas con este volumen de escritura es suficiente y simplifica
el respaldo, que es copiar una carpeta.

`better-sqlite3` se compila al instalar; si `npm ci` falla por eso, instale las
herramientas de compilación:

```bash
sudo apt install -y build-essential python3    # Debian/Ubuntu
```

## 2. Instalación

```bash
sudo useradd --system --home /opt/bytewall --shell /usr/sbin/nologin bytewall
sudo git clone https://github.com/edgarponce08/bytewall.git /opt/bytewall
cd /opt/bytewall
sudo npm ci --omit=dev
sudo mkdir -p data backups
sudo chown -R bytewall:bytewall /opt/bytewall
```

Primer arranque para ver las credenciales del administrador inicial:

```bash
sudo -u bytewall node server.js
```

```
=== Usuario administrador inicial ===
  Correo:     admin@bytewall.local
  Contrasena: 6-_KmPSnhaqt
  Cambiela despues de iniciar sesion.
```

Anote la contraseña: **solo se muestra una vez**. Si se pierde, se reinicia con
`npm run user -- passwd <correo>` (sección 7). Detenga con `Ctrl+C` y continúe.

## 3. Configuración

Toda la configuración son variables de entorno. Copie la plantilla y ajústela:

```bash
sudo -u bytewall cp .env.example .env
sudo -u bytewall nano .env
sudo chmod 600 .env      # contiene credenciales
```

Lo que casi siempre hay que cambiar:

```ini
HOST=127.0.0.1        # solo el proxy local llega al puerto de Node
COOKIE_SECURE=1       # obligatorio al servir por HTTPS
TRUST_PROXY=1         # hay nginx o Caddy delante
ADMIN_EMAIL=jefe@empresa.com
ADMIN_PASSWORD=una-clave-larga-y-propia
```

El entorno y `systemd` tienen prioridad sobre el `.env`, así que puede dejar los
secretos fuera del archivo si lo prefiere. La lista completa de variables está
en `.env.example` y en el README.

## 4. Correr como servicio

Así el programa arranca con el servidor y se reinicia si se cae:

```bash
sudo cp deploy/bytewall.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bytewall
sudo systemctl status bytewall
```

La unidad ya trae endurecimiento (`ProtectSystem=strict`, sin privilegios
nuevos) y solo permite escritura en `data/` y `backups/`. Si instala en otra
ruta, ajuste `WorkingDirectory` y `ReadWritePaths`.

Operación diaria:

```bash
sudo systemctl restart bytewall     # reiniciar
sudo systemctl stop bytewall        # detener (antes de restaurar)
sudo journalctl -u bytewall -f      # ver la bitácora en vivo
```

El servicio responde a `SIGTERM` con un cierre ordenado: deja de aceptar
conexiones y consolida el WAL de SQLite antes de salir.

## 5. HTTPS con proxy inverso

**Sin HTTPS la cookie de sesión viaja en claro por la red interna.** Cualquiera
con acceso al tráfico podría reutilizarla. Ponga siempre un proxy delante.

Con nginx:

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/bytewall
sudo ln -s /etc/nginx/sites-available/bytewall /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Con Caddy (más corto, emite el certificado solo):

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Tres detalles que suelen morder:

1. **`client_max_body_size`**: el límite de nginx es 1 MB por omisión y cortaría
   las evidencias con un error 413. En el ejemplo está en 30 MB, por encima de
   `MAX_UPLOAD_MB=25`. Si sube uno, suba el otro.
2. **`COOKIE_SECURE=1` y `TRUST_PROXY=1`** en el `.env`, o la sesión no se
   comporta bien detrás del proxy.
3. **El certificado**: lo ideal es uno de la CA interna de la empresa, para que
   nadie vea avisos. Si es autofirmado, hay que instalarlo en los equipos.

## 6. Con Docker

Si prefiere no instalar Node en el servidor:

```bash
cp .env.example .env        # ajuste ADMIN_EMAIL y ADMIN_PASSWORD
docker compose up -d
docker compose logs -f      # aquí sale la contraseña del primer admin
```

Los datos viven en el volumen `bytewall-data`. Para respaldar:

```bash
docker compose exec bytewall npm run backup -- /data/backups
docker compose cp bytewall:/data/backups ./backups
```

La imagen trae `HEALTHCHECK` contra `/api/health` y corre como usuario sin
privilegios. `init: true` en el compose asegura que `SIGTERM` llegue al proceso
y el cierre sea ordenado.

## 7. Cuentas desde la terminal

Las cuentas se administran desde la interfaz, pero la CLI resuelve el caso en
que **nadie puede entrar** (el único administrador olvidó su contraseña):

```bash
cd /opt/bytewall

sudo -u bytewall npm run user -- list
sudo -u bytewall npm run user -- passwd admin@bytewall.local
sudo -u bytewall npm run user -- add "Ana Torres" ana@empresa.com --admin
sudo -u bytewall npm run user -- add "Almacén" --no-login
sudo -u bytewall npm run user -- role ana@empresa.com member
sudo -u bytewall npm run user -- disable luis@empresa.com
sudo -u bytewall npm run user -- enable luis@empresa.com
```

Notas:

- Sin `--password=…`, `add` y `passwd` generan una contraseña y la imprimen.
- `passwd` y `disable` cierran las sesiones abiertas de esa persona.
- `disable` **no borra nada**: sus proyectos siguen asignados y sus evidencias
  intactas. Es lo que conviene usar cuando alguien deja el equipo.
- La CLI no deja quitar el rol, dar de baja ni degradar al último administrador
  con acceso: la aplicación nunca se queda sin quien la administre.

## 8. Respaldos y restauración

Se respalda **la carpeta `data/`**: ahí están la base y las evidencias.

```bash
sudo -u bytewall npm run backup
```

Usa la API de respaldo de SQLite, así que **se puede correr con el servicio
encendido** (copiar el `.db` a mano mientras hay escrituras puede corromperlo).
Deja una carpeta `backups/bytewall-<fecha>/` con la base y las evidencias.

Respaldo diario a las 2 a.m. con cron:

```bash
sudo crontab -u bytewall -e
```

```cron
0 2 * * * cd /opt/bytewall && /usr/bin/npm run backup >> /opt/bytewall/data/backup.log 2>&1
# Conservar 30 días
30 2 * * * find /opt/bytewall/backups -maxdepth 1 -name 'bytewall-*' -mtime +30 -exec rm -rf {} +
```

Copie los respaldos a otra máquina: un respaldo en el mismo disco no protege de
que ese disco falle.

Para restaurar, **con el servicio detenido**:

```bash
sudo systemctl stop bytewall
sudo -u bytewall npm run restore -- backups/bytewall-2026-07-30T02-31-00
# revise lo que va a reemplazar y repita con --confirmar
sudo -u bytewall npm run restore -- backups/bytewall-2026-07-30T02-31-00 --confirmar
sudo systemctl start bytewall
```

La restauración no borra los datos actuales: los mueve a
`data/reemplazado-<fecha>/`, por si se restauró el respaldo equivocado.

## 9. Monitoreo y bitácora

`GET /api/health` no pide sesión y sirve para el monitoreo:

```bash
curl -s http://127.0.0.1:3000/api/health
{"status":"ok","version":"1.0.0","uptime_s":128}
```

Responde `503` si SQLite deja de contestar. Apúntele su monitoreo (Zabbix,
Uptime Kuma, un cron con `curl`) y avise si algo distinto de `ok`.

El servicio escribe una línea por petición: fecha, método, ruta, código,
duración y usuario. No se registran cuerpos ni cabeceras, para no dejar
contraseñas en la bitácora.

```
2026-07-30T02:45:10.123Z POST /api/auth/login 200 61.2ms user=-
2026-07-30T02:45:12.884Z PATCH /api/projects/3 200 3.4ms user=#2
```

Con `journalctl`:

```bash
sudo journalctl -u bytewall --since today          # todo lo de hoy
sudo journalctl -u bytewall | grep ' 401 '         # accesos rechazados
sudo journalctl -u bytewall -p err                 # solo errores
```

Para desactivarlo, `LOG_REQUESTS=0`. Aparte de esta bitácora técnica, cada
proyecto guarda su propia bitácora de negocio en la aplicación (quién cambió el
estado, quién subió qué evidencia y cuándo).

## 10. Actualizar a una versión nueva

```bash
cd /opt/bytewall
sudo -u bytewall npm run backup          # primero el respaldo
sudo -u bytewall git pull
sudo -u bytewall npm ci --omit=dev
sudo systemctl restart bytewall
sudo journalctl -u bytewall -n 30        # confirme que arrancó
curl -s http://127.0.0.1:3000/api/health
```

Los cambios de esquema se aplican solos al arrancar (las tablas se crean si no
existen y las columnas nuevas se agregan a las bases anteriores). Si algo sale
mal, restaure el respaldo de la sección 8.

## 11. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `413` al subir una evidencia | `client_max_body_size` del proxy | Súbalo por encima de `MAX_UPLOAD_MB` |
| Entra y lo saca de inmediato | `COOKIE_SECURE=1` sirviendo por HTTP | Ponga HTTPS, o `COOKIE_SECURE=0` mientras prueba |
| «Demasiados intentos fallidos» | Límite de accesos | Espere 10 minutos, o suba `LOGIN_MAX_ATTEMPTS` |
| Nadie puede entrar | Se perdió la contraseña del admin | `npm run user -- passwd <correo>` |
| No arranca: `EADDRINUSE` | El puerto ya está ocupado | Cambie `PORT` o libere el 3000 |
| No arranca: `SQLITE_CANTOPEN` | Permisos de `data/` | `sudo chown -R bytewall:bytewall /opt/bytewall/data` |
| `npm ci` falla al compilar | Faltan herramientas de compilación | `sudo apt install -y build-essential python3` |
| Las evidencias no abren | Se restauró la base sin `uploads/` | Restaure el respaldo completo |
