# 05 - Operacion y despliegue

## Paquete final

- Archivo recomendado para SiteGround: `RIOH_SITEGROUND.zip`
- Copia fechada de respaldo: `RIOH_SITEGROUND_20260812.zip`
- SHA-256 esperado: `9E6433C2B75BD62D46DB4272FA9B1B720EA039E5DE7F3C444232BF63B584DE72`
- Estructura: 30 archivos en la raiz, sin subcarpetas.
- Commit funcional correspondiente: `325d37e`.

## Precondicion de base de datos

La migracion `supabase_seguridad_checkout.sql` debe estar aplicada antes de publicar. El responsable del proyecto confirmo su ejecucion el 2026-08-12.

Si faltan tablas o funciones base, ejecutar primero:

```sql
supabase_migracion_productos_integral.sql
```

Luego volver a ejecutar:

```sql
supabase_seguridad_checkout.sql
```

## Publicacion en SiteGround

1. Entrar a Site Tools > Site > File Manager.
2. Abrir `public_html`.
3. Respaldar el sitio actual.
4. Subir `RIOH_SITEGROUND.zip`.
5. Extraerlo directamente en `public_html`.
6. Confirmar que `index.html`, `admin.html` y `.htaccess` esten en la raiz.
7. Confirmar que existan `supabase.min.js` y `archivo-black-latin.woff2` directamente dentro de `public_html`.
8. Purgar cache.
9. Probar el sitio en ventana privada.

La estructura plana es intencional. No crear carpetas `vendor` o `fonts` en SiteGround con esta version.

## Acceso administrador

- URL: `/admin` o `/admin.html`.
- Usuario: email de una cuenta existente en Supabase Auth.
- Autorizacion adicional: fila con `activo = true` en `public.admin_usuarios`.
- El identificador historico `admin` ya no es una credencial valida.
- El responsable confirmo acceso correcto al panel en produccion el 2026-08-12.

## Reinicio pre-apertura

1. Ejecutar `supabase_reinicio_pre_apertura.sql` una sola vez en Supabase SQL Editor.
2. Verificar que la fila final muestre tres ceros.
3. Refrescar Pedidos, Dashboard y CRM.
4. Confirmar Productos y Gestion Stock sin cambios.
5. No generar nuevos pedidos de prueba despues del reinicio.

La consulta conserva clientes y cuentas, pero reinicia sus metricas. Tambien crea respaldos privados en `rioh_backups`. No restaura stock de pedidos de prueba: el inventario queda exactamente como estaba antes de ejecutar la consulta.

## Rollback

Si aparece un error critico:

1. Restaurar el respaldo previo de `public_html`.
2. Purgar cache.
3. Revisar consola del navegador y errores de Supabase.
4. No revertir migraciones sin respaldo de datos.

## Pendientes operativos

- Ejecutar una sola vez `supabase_reinicio_pre_apertura.sql` antes de comenzar a recibir pedidos reales.
- Confirmar que pedidos, metricas de clientes y movimientos historicos queden en cero.
- Supervisar el primer pedido real y confirmar descuento de stock.
