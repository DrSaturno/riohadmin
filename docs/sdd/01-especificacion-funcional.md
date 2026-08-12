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
- Librerias JS locales en la raiz del paquete.
- Fuentes locales WOFF2 en la raiz del paquete.
- Imagen mobile `versionmobile.webp` en el hero mobile.
- Instrucciones de despliegue y verificacion.

### Criterios de aceptacion

- El ZIP contiene `index.html`, `admin.html` y `.htaccess` en la raiz.
- El ZIP no contiene SQL, Git, temporales, respaldos ni otros ZIPs.
- No hay dependencias runtime a CDN externos.
- El hash del paquete final queda documentado.
- La migracion de Supabase esta aplicada antes de publicar.

## SDD-004 - Compatibilidad de assets con SiteGround

Estado: `Publicado y verificado`

### Objetivo

Evitar que la extraccion plana de SiteGround rompa las rutas de librerias y fuentes.

### Alcance

- ZIP sin subcarpetas.
- HTML, librerias, fuentes e imagenes directamente en `public_html`.
- Versionado de URLs para invalidar cache de respuestas 404 anteriores.
- Mensaje controlado si el SDK de Supabase no puede inicializarse.

### Criterios de aceptacion

- La tienda carga menu y fuentes sin solicitudes a `/vendor/` o `/fonts/`.
- El panel carga Supabase, formulario de acceso y fuentes sin errores de assets.
- El script de empaquetado rechaza subcarpetas y archivos obligatorios ausentes.
- El responsable confirma el funcionamiento en produccion.

## SDD-005 - Reinicio pre-apertura

Estado: `Implementado; pendiente de ejecucion en Supabase`

### Objetivo

Comenzar la operacion real con pedidos, dashboard y metricas de venta en cero sin alterar el menu ni el inventario configurado.

### Alcance

- Respaldar pedidos, clientes, movimientos y beneficios en el schema privado `rioh_backups`.
- Eliminar pedidos de prueba y sus movimientos asociados.
- Reiniciar metricas acumuladas de clientes.
- Reiniciar usos de cupones y promociones.
- Reiniciar la secuencia de numero de pedido cuando PostgreSQL la exponga.

### Fuera de alcance

- Productos y hamburguesas.
- Categorias, recetas, precios e imagenes.
- Insumos y cantidades actuales de stock.
- Configuracion del negocio.
- Usuarios de Supabase Auth y autorizaciones administrativas.

### Criterios de aceptacion

- La consulta final devuelve `pedidos = 0`, `clientes_con_metricas = 0` y `movimientos_stock = 0`.
- La huella completa de `public.productos` es identica antes y despues.
- El inventario queda exactamente en su valor previo al reinicio.
- La consulta no puede ejecutarse por segunda vez accidentalmente con el mismo respaldo.
