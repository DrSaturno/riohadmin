# 04 - Plan de pruebas

## Pruebas de sintaxis

Ejecutar antes de empaquetar:

```powershell
node --check main.js
node --check admin.js
```

Si se validan librerias locales:

```powershell
node --check vendor/lucide.min.js
node --check vendor/supabase.min.js
node --check vendor/jspdf.umd.min.js
node --check vendor/jspdf.plugin.autotable.min.js
node --check vendor/qz-tray.js
```

## Pruebas visuales publicas

- Desktop: hero, menu, modal de producto, carrito, checkout, footer.
- Mobile 320 px: hero mobile con `versionmobile.webp`, CTA visible, menu sin overflow.
- Mobile 390 px: modal de producto y checkout usable.
- Tablet: categorias, grillas y footer sin solapamientos.

## Pruebas funcionales publicas

- Cargar menu desde Supabase.
- Agregar producto simple.
- Agregar producto doble.
- Agregar extras.
- Aplicar cupon valido.
- Rechazar cupon invalido.
- Confirmar pedido.
- Ver comprobante.
- Confirmar vencimiento/limpieza del ultimo comprobante local.

## Pruebas administrativas

- Login con usuario autorizado.
- Rechazo de usuario no autorizado.
- Ver pedidos.
- Cambiar estado hacia adelante.
- Retroceder estado y validar restauracion cuando aplique.
- Cancelar pedido y validar auditoria.
- Crear/editar/desactivar producto.
- Revisar stock e insumos.
- Probar impresion por navegador.

## Pruebas de despliegue

- Confirmar `.htaccess` en raiz del ZIP.
- Confirmar `vendor/supabase.min.js` y las cinco librerias locales dentro del ZIP.
- Confirmar las cuatro fuentes WOFF2 dentro de `fonts/`.
- Confirmar que no haya SQL dentro del ZIP.
- Confirmar que no haya `.git`, `tmp`, backups ni ZIPs previos dentro del ZIP.
- Confirmar hash del paquete.
- Probar en ventana privada luego de extraer en SiteGround.
- Purgar cache de SiteGround/CDN despues de publicar.
