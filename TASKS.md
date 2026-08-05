# TASKS.md — Seguimiento SDD

**Proyecto:** RIOH Admin / tienda online

**Metodologia:** Spec-Driven Development (SDD)

**Ultima actualizacion:** 2026-08-05

## SDD-001 — Gestion integral de productos, categorias y stock

**Estado:** Implementacion completada; migracion aplicada; verificacion operativa pendiente.

### Especificacion

- Administrar categorias antes de asignarlas a productos.
- Permitir categorias de venta directa o productos configurables.
- Mantener orden, visibilidad, recetas y disponibilidad desde el tablero.
- Validar el stock real del carrito antes de confirmar un pedido.
- Descontar y restaurar stock de forma atomica al cambiar el estado del pedido.
- Conservar pedidos cancelados y su trazabilidad.
- Reemplazar las credenciales fijas del administrador por Supabase Auth.

### Criterios de aceptacion

- [x] CRUD de categorias disponible desde el modulo Productos.
- [x] Selector de categoria alimentado desde `categorias_productos`.
- [x] Catalogo publico generado desde categorias y productos activos.
- [x] Productos directos y configurables soportados.
- [x] Recetas, multiplicador doble y extras vinculados al inventario.
- [x] Validacion agregada del carrito antes del alta del pedido.
- [x] Movimiento de stock serializado y registrado por pedido.
- [x] Avance, retroceso y cancelacion de pedidos mediante RPC seguras.
- [x] Cancelacion con restauracion de stock y auditoria, sin borrar historial.
- [x] RLS, permisos de Storage y autorizacion mediante `admin_usuarios`.
- [x] Correccion de la receta de papas de 200 g a 0.2 kg.
- [x] Alta controlada del insumo Cebolla Morada.
- [x] Textos de WhatsApp y bloque de Instagram ajustados.

### Implementacion y datos

- [x] Frontend y administrador actualizados.
- [x] Carpeta `entrega_siteground` sincronizada con los fuentes.
- [x] Guia operativa de categorias, orden, stock y recetas documentada en `GUIA_ADMIN_PRODUCTOS.md`.
- [x] Migracion `supabase_migracion_productos_integral.sql` preparada y validada.
- [x] Migracion ejecutada en Supabase por el responsable del proyecto el 2026-08-05.
- [ ] Crear el usuario administrador en Supabase Auth y asociarlo a `public.admin_usuarios`.
- [ ] Confirmar el valor real cargado para el stock inicial de Cebolla Morada.

### Verificacion realizada

- [x] Sintaxis de `admin.js` y `main.js` validada con Node.js.
- [x] Estructura de `admin.html` e `index.html` validada.
- [x] Migracion PostgreSQL parseada correctamente: 103 sentencias.
- [x] Fuentes y carpeta de entrega comparados por hash.
- [x] Version publicada en `main` y desplegada correctamente en Vercel el 2026-08-05.
- [ ] Confirmar inicio de sesion real en el administrador.
- [ ] Ejecutar una compra de prueba y recorrer avance, retroceso y cancelacion.
- [x] `RIOH_SITEGROUND.zip` regenerado y verificado el 2026-08-05 (21 archivos en la raiz del paquete).

### Decisiones tecnicas

- Las categorias son datos administrables, no constantes del frontend.
- Un producto utilizado por pedidos se desactiva en lugar de eliminarse.
- Un pedido cancelado se conserva para auditoria.
- El ledger `movimientos_stock_pedido` es la fuente para restaurar exactamente el stock descontado.
- El acceso administrativo requiere una cuenta activa tanto en Supabase Auth como en `admin_usuarios`.
- El orden se gestiona con enteros ascendentes; se recomiendan intervalos de diez.
- Un producto con receta obtiene su disponibilidad desde los insumos y no utiliza el stock directo.
- El consumo doble se calcula por ingrediente mediante `cantidad simple x doble_mult`.

### Proximo paso

Crear el usuario de Supabase Auth, validar el acceso administrativo y completar una compra de prueba de punta a punta antes de publicar en SiteGround.
