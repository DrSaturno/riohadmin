# 02 - Arquitectura y contratos

## Superficies del sistema

- `index.html`: tienda publica, menu, carrito, checkout y comprobante.
- `main.js`: logica de tienda publica, Supabase client, carrito, cotizacion y pedido.
- `style.css`: estilos publicos responsive.
- `admin.html`: panel administrativo y estilos embebidos del tablero.
- `admin.js`: autenticacion, pedidos, productos, clientes, stock, reportes e impresion.
- `supabase_migracion_productos_integral.sql`: migracion base de productos, stock y administracion.
- `supabase_seguridad_checkout.sql`: migracion de seguridad, RLS, RPCs y checkout transaccional.
- `SITEGROUND_INSTRUCCIONES.md`: guia de despliegue.

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

