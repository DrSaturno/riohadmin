# 02 - Arquitectura y contratos

## Superficies del sistema

- `index.html`: tienda publica, menu, carrito, checkout y comprobante.
- `main.js`: logica de tienda publica, Supabase client, carrito, cotizacion y pedido.
- `style.css`: estilos publicos responsive.
- `admin.html`: panel administrativo y estilos embebidos del tablero.
- `admin.js`: autenticacion, pedidos, productos, clientes, stock, reportes e impresion.
- `supabase_migracion_productos_integral.sql`: migracion base de productos, stock y administracion.
- `supabase_seguridad_checkout.sql`: migracion de seguridad, RLS, RPCs y checkout transaccional.
- `supabase_reinicio_pre_apertura.sql`: operacion destructiva controlada para retirar datos de prueba antes de la apertura.
- `scripts/build-siteground.ps1`: genera y valida el ZIP plano de produccion.
- `SITEGROUND_INSTRUCCIONES.md`: guia de despliegue.

## Contrato de archivos SiteGround

SiteGround dejo todos los elementos del ZIP directamente en `public_html`. Por compatibilidad, el paquete oficial es deliberadamente plano:

- No existen carpetas runtime `vendor/` ni `fonts/`.
- `supabase.min.js`, `lucide.min.js`, jsPDF, QZ Tray y las fuentes WOFF2 viven en la raiz.
- `index.html`, `admin.html` y `fonts.css` deben usar rutas relativas a la raiz.
- No volver a introducir subcarpetas sin cambiar simultaneamente HTML, CSS, empaquetado y pruebas de produccion.

## Contratos frontend-publico

El frontend publico puede:

- Leer configuracion publica.
- Obtener menu publico mediante RPC.
- Solicitar cotizacion mediante RPC.
- Crear pedido mediante RPC.
- Guardar datos locales de sesion estrictamente necesarios.

El frontend publico no debe:

- Insertar pedidos escribiendo directo en tablas.
- Calcular totales como fuente de verdad.
- Consultar tablas sensibles de clientes, pedidos, cupones o stock.
- Guardar datos personales de invitados como perfil permanente.

## Contratos del administrador

El panel puede operar datos sensibles solo si:

- Existe sesion valida de Supabase Auth.
- El usuario esta habilitado en `public.admin_usuarios`.
- Las operaciones criticas usan RPCs o politicas RLS seguras.

## Contratos de datos

- Los precios finales y descuentos se calculan en Supabase.
- El stock se descuenta y restaura de forma transaccional.
- Los cambios de estado deben conservar auditoria suficiente.
- Un pedido cancelado no se elimina.
- Las migraciones deben documentar prerequisitos y pasos posteriores.

## Contrato de autenticacion administrativa

- El acceso anterior con usuario local `admin` fue eliminado porque exponia una contrasena dentro del JavaScript publico.
- El campo de acceso actual requiere el email real de Supabase Auth, no el texto `admin`.
- La cuenta debe existir en `auth.users` y tener una fila activa en `public.admin_usuarios`.
- No restaurar `ADMIN_USERS`, contrasenas fijas ni sesiones administrativas basadas solo en `sessionStorage`.

## Contrato del reinicio pre-apertura

- `supabase_reinicio_pre_apertura.sql` se ejecuta una sola vez y fuera del ZIP publico.
- Conserva perfiles de clientes, pero pone sus metricas de compra en cero.
- Elimina pedidos; `movimientos_stock_pedido` se elimina por cascada.
- No invoca funciones de restauracion de stock de pedidos de prueba.
- Protege `public.productos` con una huella antes/despues y revierte toda la transaccion si cambia.
