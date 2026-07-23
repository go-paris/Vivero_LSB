# Decisión de arquitectura — Vivero Lemú

## Estado

Aprobada para desarrollo y validación institucional. No implica todavía autorización de producción.

## Separación

Vivero Lemú es una aplicación independiente del PMV y de SUIF 2046. Utiliza una base exclusiva cuyo nombre debe comenzar con `vivero_lemu_`. El código rechaza `bosques_chubut` y cuentas `root`.

## Integración futura

SUIF podrá consumir indicadores agregados de producción, sanidad, capacidad e inversión. No recibirá coordenadas de fichaje, horarios individuales ni credenciales.

## Despliegue

- GitHub privado: código y revisión.
- Railway: aplicación, base y variables de entorno.
- n8n: avisos y resúmenes autorizados; no autentica, no valida geocercas y no modifica fichadas.

## Privacidad

La geolocalización se solicita únicamente al registrar entrada o salida. No se implementa seguimiento continuo. Los originales de asistencia no se eliminan; las correcciones deben ser eventos auditados.

## Geocerca validada

- Sede: Vivero Provincial Lemú, El Maitén.
- Centro informado por la autoridad del proyecto el 22/07/2026: `-42.061998, -71.193158`.
- Radio inicial: 200 metros.
- Versión inicial: `LEMU-001`.

Estos valores se suministran mediante variables de ambiente. El navegador no contiene el centro ni decide si una posición es válida.
