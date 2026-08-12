# Publicacion de RIOH en SiteGround

El paquete recomendado `RIOH_SITEGROUND.zip` esta listo para extraerse directamente dentro de `public_html`.

## 1. Paso obligatorio en Supabase

Antes de reemplazar el sitio, abrir **Supabase > SQL Editor** y ejecutar completo:

`supabase_seguridad_checkout.sql`

La migracion es idempotente y protege clientes, pedidos, cupones, promociones, inventario y configuracion. Tambien instala el checkout transaccional que calcula precios y descuentos en el servidor.

Si informa que falta la migracion base, ejecutar primero `supabase_migracion_productos_integral.sql` y luego volver a ejecutar `supabase_seguridad_checkout.sql`.

No subir ningun archivo SQL a `public_html`.

## 2. Subida a SiteGround

1. Abrir **Site Tools > Site > File Manager**.
2. Entrar a `public_html` y guardar un respaldo del sitio actual.
3. Subir `RIOH_SITEGROUND.zip`.
4. Extraer el ZIP directamente en `public_html`.
5. Confirmar que `index.html`, `admin.html` y `.htaccess` queden en la raiz, no dentro de otra carpeta.
6. Confirmar que existan `public_html/vendor/supabase.min.js` y `public_html/fonts/archivo-black-latin.woff2`.
7. Purgar la cache de SiteGround y cualquier CDN activo.

## 3. Verificacion posterior

1. Abrir el sitio en una ventana privada y confirmar que carguen menu, imagenes y horarios.
2. Hacer un pedido de prueba de punta a punta y luego cancelarlo desde el panel.
3. Verificar que el stock se descuente al aprobar y se reintegre al retroceder o cancelar.
4. Probar un cupon y confirmar que el total del panel coincida con el comprobante.
5. Abrir `/admin`, iniciar sesion y revisar productos, pedidos, clientes, stock y horarios.
6. Confirmar que el dominio use HTTPS antes de habilitar pedidos reales.

Si el menu queda en "CARGANDO MENU" o el panel informa que no puede cargar autenticacion, revisar primero las carpetas `vendor` y `fonts`: ambas son obligatorias y deben conservarse al extraer el ZIP.

## Seguridad adicional

Cloudflare no es obligatorio para proteger los datos: la proteccion principal queda en RLS y las RPC de Supabase. Puede agregarse como CDN/WAF para mitigar bots y ataques al sitio estatico. Para proteger tambien el endpoint de pedidos contra abuso avanzado, el checkout tendria que pasar por una Edge Function o Worker con rate limiting/Turnstile; poner Cloudflare solamente delante de SiteGround no cubre llamadas directas a Supabase.

La impresion silenciosa con QZ Tray queda deshabilitada en produccion hasta configurar certificado y firma digital. El panel usa la impresion segura del navegador como alternativa.

El ZIP no contiene SQL, Git, temporales, respaldos ni archivos de desarrollo.

**Generado:** 2026-08-12

**SHA-256:** `D0FD556DC1229EA9B5C74E283EE7F879E79AF57E908671A1CE5543B2A83C014C`
