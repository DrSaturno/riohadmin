# 00 - Proceso SDD

## Objetivo

Mantener el proyecto RIOH con trazabilidad entre necesidad, decision tecnica, cambio de codigo, migracion de datos, prueba y despliegue.

## Flujo obligatorio

1. Definir o actualizar una especificacion en `docs/sdd`.
2. Registrar criterios de aceptacion antes de implementar.
3. Identificar impacto en Supabase, SiteGround, seguridad, privacidad y assets.
4. Implementar con cambios acotados.
5. Verificar con pruebas de sintaxis, flujo manual y revision visual cuando corresponda.
6. Actualizar `TASKS.md` con estado, evidencias y pendientes.
7. Regenerar paquete de entrega si el cambio afecta archivos publicables.

## Estados SDD

- `Propuesto`: existe la necesidad, pero falta diseno.
- `Especificado`: objetivo, alcance y criterios estan escritos.
- `Implementado`: el codigo o la migracion ya fueron modificados.
- `Verificado`: hay evidencia de pruebas suficientes.
- `Publicado`: el cambio fue subido a GitHub y/o empaquetado para hosting.
- `Bloqueado`: requiere accion externa, credenciales, datos o decision del responsable.

## Convenciones

- Cada entrega debe tener un identificador `SDD-XXX`.
- Los criterios deben poder marcarse como cumplidos o no cumplidos.
- Las migraciones SQL deben ser idempotentes cuando sea posible.
- El frontend publico no debe depender de credenciales privadas.
- El panel administrador debe operar solo con usuarios autorizados por Supabase Auth y `admin_usuarios`.
- Los archivos de entrega no deben incluir SQL, `.git`, temporales, respaldos ni ZIPs previos.

