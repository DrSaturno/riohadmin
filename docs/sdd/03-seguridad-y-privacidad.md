# 03 - Seguridad y privacidad

## Objetivo

Reducir exposicion de datos y manipulacion del negocio en una app estatica alojada en SiteGround con backend Supabase.

## Controles aplicados

- RLS reforzado en tablas sensibles.
- Grants publicos minimos.
- RPCs para menu, cotizacion, creacion de pedido y transiciones de estado.
- Calculo de precios, cupones y stock en servidor.
- Idempotencia en checkout.
- Comprobante local con vencimiento de 24 horas.
- Noindex para `admin.html`.
- `.htaccess` con HTTPS, HSTS, CSP, bloqueo de SQL/documentos/ZIPs y compresion.
- Librerias runtime locales para reducir dependencia externa.
- QZ Tray sin impresion silenciosa sin certificado en produccion.
- Acceso administrativo mediante Supabase Auth y lista activa `admin_usuarios`; no hay credenciales fijas en el frontend.
- Respaldo pre-apertura en schema privado `rioh_backups`, sin permisos para `PUBLIC`, `anon` ni `authenticated`.

## Datos sensibles

Se consideran sensibles:

- Nombre, telefono, direccion, piso/departamento, notas de entrega.
- Historial de pedidos.
- Cupones, promociones, precios y reglas de descuento.
- Inventario y movimientos de stock.
- Usuarios administradores.

## Reglas para cambios futuros

- No agregar service keys, tokens privados ni credenciales de administrador al frontend.
- No relajar RLS para corregir errores de permisos sin revisar el contrato afectado.
- No depender del precio enviado por el navegador para confirmar pedidos.
- No subir archivos `.sql`, `.md` internos o ZIPs al hosting publico.
- Revisar cualquier dependencia externa antes de agregarla al runtime.
- No exponer el schema `rioh_backups` en la API de Supabase.
- No eliminar el respaldo pre-apertura hasta confirmar la operacion real y la politica de retencion de datos.

## Cloudflare

Cloudflare no es requisito para proteger datos si RLS y RPCs estan correctamente aplicados. Puede sumar WAF, cache y mitigacion de bots para el sitio estatico. Para limitar abuso directo contra Supabase se requiere una capa adicional como Edge Function o Worker con rate limiting y/o Turnstile.
