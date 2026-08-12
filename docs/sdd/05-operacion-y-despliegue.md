# 05 - Operacion y despliegue

## Paquete final

- Archivo recomendado para SiteGround: `RIOH_SITEGROUND.zip`
- Copia fechada de respaldo: `RIOH_SITEGROUND_20260812.zip`
- SHA-256 esperado: `3FAD85D85B9D7320A4770EA2CE083F90F58EB53423B9C3AE0015CA20F277D8F2`

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
7. Purgar cache.
8. Probar el sitio en ventana privada.

## Rollback

Si aparece un error critico:

1. Restaurar el respaldo previo de `public_html`.
2. Purgar cache.
3. Revisar consola del navegador y errores de Supabase.
4. No revertir migraciones sin respaldo de datos.

## Pendientes operativos

- Confirmar usuario administrador final en Supabase Auth.
- Confirmar filas correspondientes en `public.admin_usuarios`.
- Realizar pedido real controlado despues de publicar.
- Cancelar el pedido de prueba desde admin y verificar stock.

