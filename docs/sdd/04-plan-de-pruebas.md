# 04 - Plan de pruebas

## Pruebas de sintaxis

Ejecutar antes de empaquetar:

```powershell
node --check main.js
node --check admin.js
```

Si se validan librerias locales:

```powershell
node --check lucide.min.js
node --check supabase.min.js
node --check jspdf.umd.min.js
node --check jspdf.plugin.autotable.min.js
node --check qz-tray.js
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
- Confirmar `supabase.min.js` y las cinco librerias locales en la raiz del ZIP.
- Confirmar las cuatro fuentes WOFF2 en la raiz del ZIP.
- Confirmar que el ZIP no contenga subcarpetas.
- Confirmar que no haya SQL dentro del ZIP.
- Confirmar que no haya `.git`, `tmp`, backups ni ZIPs previos dentro del ZIP.
- Confirmar hash del paquete.
- Probar en ventana privada luego de extraer en SiteGround.
- Purgar cache de SiteGround/CDN despues de publicar.

## Verificacion pre-apertura

Ejecutar `supabase_reinicio_pre_apertura.sql` como ultima operacion de datos antes de recibir pedidos reales.

- Confirmar `pedidos = 0`.
- Confirmar `clientes_con_metricas = 0`.
- Confirmar `movimientos_stock = 0`.
- Refrescar Pedidos y Dashboard; ambos deben quedar vacios y con importes en cero.
- Confirmar que Productos sigue mostrando las hamburguesas, precios, recetas e imagenes existentes.
- Confirmar que Gestion Stock conserva exactamente las cantidades configuradas antes del reinicio.
- No crear otro pedido de prueba despues del reinicio. El siguiente pedido debe ser el primero de operacion real.

## Primera operacion real

- Supervisar el primer pedido real de punta a punta.
- Confirmar numeracion, total, cliente, estado y ticket.
- Confirmar descuento de stock al aprobar.
- No cancelar el primer pedido real salvo que la operacion lo requiera.
