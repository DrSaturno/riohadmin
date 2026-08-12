# 01 - Especificacion funcional

## SDD-001 - Catalogo, productos, categorias y stock

Estado: `Publicado`

### Objetivo

Permitir administrar el menu de RIOH desde el panel y mantener una operacion confiable de productos, categorias, recetas, stock y pedidos.

### Alcance

- CRUD de categorias y productos.
- Productos directos y configurables.
- Recetas vinculadas a insumos.
- Control de stock y disponibilidad.
- Estados de pedidos con descuento y restauracion de stock.
- Catalogo publico alimentado desde Supabase.

### Criterios de aceptacion

- Las categorias activas ordenan el catalogo publico.
- Los productos activos aparecen en la categoria correcta.
- Los productos configurables permiten tamanos y extras soportados.
- El stock se valida antes de confirmar operaciones sensibles.
- Un pedido cancelado conserva trazabilidad.
- El panel no permite operar sin usuario administrativo valido.

## SDD-002 - Checkout seguro

Estado: `Publicado`

### Objetivo

Mover los calculos sensibles del checkout al servidor para evitar manipulacion de precios, cupones, stock y estados desde el navegador.

### Alcance

- RPC de cotizacion del carrito.
- RPC de creacion de pedido.
- Validacion server-side de precios, descuentos y disponibilidad.
- Idempotencia de pedidos.
- Restricciones RLS y grants publicos minimos.
- Persistencia local acotada para comprobantes de invitados.

### Criterios de aceptacion

- El cliente no puede crear pedidos escribiendo directo en tablas sensibles.
- El total del pedido se calcula en Supabase.
- Los cupones se validan en Supabase.
- Los datos personales de invitados no se guardan como perfil permanente.
- Los comprobantes locales vencen a las 24 horas.
- La migracion `supabase_seguridad_checkout.sql` se puede ejecutar sin romper despliegues existentes.

## SDD-003 - Entrega SiteGround

Estado: `Publicado`

### Objetivo

Preparar un paquete estatico listo para subir a SiteGround con assets locales, reglas de seguridad HTTP y documentacion operativa.

### Alcance

- ZIP publicable en raiz de `public_html`.
- `.htaccess` con HTTPS, headers de seguridad, cache y proteccion de archivos internos.
- Librerias JS locales en `vendor`.
- Fuentes locales en `fonts`.
- Imagen mobile `versionmobile.webp` en el hero mobile.
- Instrucciones de despliegue y verificacion.

### Criterios de aceptacion

- El ZIP contiene `index.html`, `admin.html` y `.htaccess` en la raiz.
- El ZIP no contiene SQL, Git, temporales, respaldos ni otros ZIPs.
- No hay dependencias runtime a CDN externos.
- El hash del paquete final queda documentado.
- La migracion de Supabase esta aplicada antes de publicar.

