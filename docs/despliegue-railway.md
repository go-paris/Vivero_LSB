# Despliegue controlado en Railway

## Servicios

1. Aplicación conectada al repositorio privado de GitHub.
2. MySQL exclusivo con base `vivero_lemu_production`.
3. Volumen persistente montado en `/app/uploads`.

No reutilizar bases, cuentas ni secretos del SUIF.

## Orden obligatorio

1. Crear el servicio MySQL.
2. Provisionar las cuentas `vivero_deployer` y `vivero_app` usando localmente `database/production/provision-users.sql.example` con claves nuevas.
3. Configurar temporalmente las credenciales de `vivero_deployer` y ejecutar una sola vez:
   `SCHEMA_APPLY_CONFIRM=vivero_lemu_production npm run schema:apply`.
4. Cambiar a las credenciales de `vivero_app` y ejecutar `npm run schema:verify`.
5. Crear el Director General inicial con `npm run admin:create`.
6. Cargar el equipo con `INITIAL_TEAM_PASSWORD` y `npm run team:seed`. El identificador aprobado es `gustavo.paris`; los nueve usuarios quedan obligados a cambiar su clave al ingresar.
7. Eliminar inmediatamente `INITIAL_ADMIN_*` e `INITIAL_TEAM_PASSWORD` de Railway.
8. Eliminar la cuenta MySQL `vivero_deployer` después de verificar el esquema.
9. Configurar las variables definitivas y ejecutar `npm run production:preflight`.
10. Desplegar la aplicación, generar el dominio HTTPS y establecer `ALLOWED_ORIGIN` con ese origen exacto.
11. Montar el volumen en `/app/uploads` y establecer `UPLOAD_DIR=/app/uploads`.
12. Verificar `/health`, login, cambio obligatorio de clave, permisos y fichaje desde un teléfono.
13. Activar backups de MySQL antes de entregar accesos.

## Geocerca aprobada

```text
VIVERO_SITE_CODE=LEMU_EL_MAITEN
VIVERO_LATITUDE=-42.061998
VIVERO_LONGITUDE=-71.193158
VIVERO_RADIUS_METERS=200
VIVERO_MAX_ACCURACY_METERS=100
VIVERO_GEOFENCE_VERSION=LEMU-001
```

## n8n

Mantener `N8N_ENABLED=0` en la primera publicación. n8n será un servicio separado y no recibirá contraseñas, cookies ni coordenadas completas. Su activación se realizará después de validar asistencia, alertas, usuarios y backups.
