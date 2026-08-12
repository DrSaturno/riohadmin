# 06 - Handoff operativo

## Proposito

Este documento es el punto de entrada para otra persona o IA. Resume el estado real del proyecto al 2026-08-12 y evita repetir diagnosticos ya resueltos.

## Estado confirmado

- Rama funcional: `main`.
- Commit de aplicacion publicado: `325d37e`.
- Sitio: `https://riohburgers.com.ar`.
- Hosting: SiteGround, raiz `public_html`.
- Backend: Supabase `xjoyrjzvdfwavnvnfnvt`.
- Migraciones base y seguridad: aplicadas.
- Tienda publica y panel administrador: confirmados funcionando por el responsable.
- ZIP vigente: `RIOH_SITEGROUND.zip`.
- SHA-256: `9E6433C2B75BD62D46DB4272FA9B1B720EA039E5DE7F3C444232BF63B584DE72`.
- Reinicio de pedidos pre-apertura: preparado pero no confirmado como ejecutado.

## Decision de hosting que no debe revertirse

SiteGround aplano las carpetas internas durante la extraccion. La solucion vigente tambien es plana: los 30 archivos del ZIP van directamente en `public_html`.

Las dependencias se cargan como `/supabase.min.js`, `/lucide.min.js`, `/jspdf.umd.min.js`, etc. Las fuentes se cargan como `/archivo-black-latin.woff2`, `/outfit-latin.woff2`, `/inter-latin.woff2` y `/syne-latin.woff2`.

No cambiar estas rutas a `/vendor/...` o `/fonts/...` sin redisenar y volver a verificar todo el despliegue.

## Incidente resuelto

Sintomas observados:

- Fuente RIOH reemplazada por una tipografia generica.
- Menu detenido en `CARGANDO MENU`.
- `Supabase SDK not found`.
- Panel administrador sin autenticacion.

Causa: HTML/CSS buscaban subcarpetas que no existian en SiteGround. Se resolvio con estructura plana, versionado `20260812.5` y empaquetado validado. El responsable confirmo luego que el acceso administrativo funcionaba.

## Autenticacion administrativa

El panel ya no acepta una credencial local `admin`. Esa implementacion guardaba la contrasena en JavaScript publico y fue retirada.

El flujo vigente exige:

1. Usuario creado en Supabase Authentication.
2. Inicio con el email completo y su contrasena.
3. Fila activa para ese `user_id` en `public.admin_usuarios`.

No introducir credenciales fijas, service keys ni bypasses de RLS en archivos publicos.

## Reinicio de pedidos antes de abrir

Archivo: `supabase_reinicio_pre_apertura.sql`.

Estado: pendiente hasta que el responsable confirme su ejecucion.

La consulta:

- Crea respaldos privados en `rioh_backups`.
- Elimina todos los pedidos de prueba.
- Elimina movimientos asociados por cascada.
- Reinicia pedidos, gasto y ultima compra de los clientes.
- Reinicia usos de cupones y promociones.
- Reinicia la secuencia del numero de pedido si corresponde.
- Impide una segunda ejecucion accidental con el mismo respaldo.

La consulta no modifica:

- Productos ni hamburguesas.
- Categorias, recetas, precios o imagenes.
- Insumos o cantidades de stock.
- Configuracion del negocio.
- Usuarios Auth o `admin_usuarios`.

El stock no se restaura deliberadamente: debe conservar el valor actual configurado antes de la apertura.

Resultado obligatorio despues de ejecutar:

```text
pedidos = 0
clientes_con_metricas = 0
movimientos_stock = 0
```

Despues del reinicio no se deben crear mas pedidos de prueba. El siguiente pedido debe ser el primero real.

## Orden recomendado para continuar

1. Leer `TASKS.md` y este handoff.
2. Revisar `git status` antes de editar.
3. Confirmar con el responsable si `supabase_reinicio_pre_apertura.sql` ya fue ejecutado.
4. Si no fue ejecutado, pedir que lo ejecute en Supabase SQL Editor.
5. Verificar Dashboard, Pedidos y metricas en cero.
6. Confirmar Productos y Gestion Stock sin cambios.
7. Supervisar el primer pedido real de punta a punta.

## Reglas de entrega

- Los SQL nunca se incluyen en el ZIP de SiteGround.
- Regenerar el ZIP solo si cambia un archivo publico listado en `scripts/build-siteground.ps1`.
- Mantener la estructura plana y validar que el ZIP no tenga subcarpetas.
- Purgar cache de SiteGround despues de cada cambio publicable.
- No borrar `rioh_backups` ni intentar restaurarlo automaticamente sin revisar si ya existen pedidos reales posteriores al reinicio.

## Pendientes previos a operacion

- Confirmar ejecucion exitosa de `supabase_reinicio_pre_apertura.sql`. Hasta esa confirmacion, no marcar SDD-005 como verificado.
- Confirmar el stock inicial real de Cebolla Morada desde Gestion Stock.

Los cambios de documentacion y SQL no requieren regenerar ni volver a subir el ZIP de SiteGround.
