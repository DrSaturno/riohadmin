# RIOH - Documentacion SDD

Este directorio organiza el proyecto bajo una practica de Spec-Driven Development (SDD): primero se deja escrita la intencion, luego el diseno, despues la implementacion y finalmente la verificacion.

## Indice

- [00 - Proceso SDD](00-proceso-sdd.md)
- [01 - Especificacion funcional](01-especificacion-funcional.md)
- [02 - Arquitectura y contratos](02-arquitectura-y-contratos.md)
- [03 - Seguridad y privacidad](03-seguridad-y-privacidad.md)
- [04 - Plan de pruebas](04-plan-de-pruebas.md)
- [05 - Operacion y despliegue](05-operacion-y-despliegue.md)
- [06 - Handoff operativo](06-handoff-operativo.md)

## Estado actual

- Fecha de actualizacion: 2026-08-12
- Version lista para SiteGround: `RIOH_SITEGROUND.zip`
- SHA-256 del ZIP: `9E6433C2B75BD62D46DB4272FA9B1B720EA039E5DE7F3C444232BF63B584DE72`
- Estructura de hosting: plana; todos los archivos van directamente en `public_html`
- Migracion de seguridad aplicada en Supabase: confirmada por el responsable del proyecto
- Tienda y acceso administrativo en produccion: confirmados por el responsable el 2026-08-12
- Reinicio de pedidos pre-apertura: preparado, pendiente de ejecucion/confirmacion
- Rama publicada en GitHub: `main`
- Commit de la aplicacion publicada: `325d37e`

Antes de continuar trabajo operativo, leer `06-handoff-operativo.md`. Ese archivo es la fuente de verdad resumida para una nueva persona o IA.

## Regla de trabajo

Todo cambio nuevo debe empezar en una especificacion SDD antes de tocar codigo. La especificacion minima debe incluir:

1. Objetivo del cambio.
2. Alcance y fuera de alcance.
3. Criterios de aceptacion verificables.
4. Impacto en datos, seguridad y despliegue.
5. Plan de prueba manual o automatizado.
