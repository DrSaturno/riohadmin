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
- [x] Migracion `supabase_migracion_productos_integral.sql` preparada y validada.
- [x] Migracion ejecutada en Supabase por el responsable del proyecto el 2026-08-05.
- [x] Usuario de Supabase Auth asociado a `public.admin_usuarios`, segun confirmacion del responsable.
- [x] Stock inicial de Cebolla Morada cargado, segun confirmacion del responsable.

### Verificacion realizada

- [x] Sintaxis de `admin.js` y `main.js` validada con Node.js.
- [x] Estructura de `admin.html` e `index.html` validada.
- [x] Migracion PostgreSQL parseada correctamente: 103 sentencias.
- [x] Fuentes y carpeta de entrega comparados por hash.
- [ ] Confirmar inicio de sesion real en el administrador.
- [ ] Ejecutar una compra de prueba y recorrer avance, retroceso y cancelacion.
- [ ] Publicar la version actualizada.
- [ ] Regenerar `RIOH_SITEGROUND.zip` si se utilizara ese paquete para publicar.

### Decisiones tecnicas

- Las categorias son datos administrables, no constantes del frontend.
- Un producto utilizado por pedidos se desactiva en lugar de eliminarse.
- Un pedido cancelado se conserva para auditoria.
- El ledger `movimientos_stock_pedido` es la fuente para restaurar exactamente el stock descontado.
- El acceso administrativo requiere una cuenta activa tanto en Supabase Auth como en `admin_usuarios`.

### Proximo paso

Validar el acceso administrativo con el email creado en Supabase Auth y luego completar una compra de prueba de punta a punta antes de publicar.
