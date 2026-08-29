# TASKS.md - Seguimiento SDD

**Proyecto:** RIOH Admin / tienda online

**Metodologia:** Spec-Driven Development (SDD)

**Ultima actualizacion:** 2026-08-29

## Indice SDD

- Proceso: `docs/sdd/00-proceso-sdd.md`
- Especificacion funcional: `docs/sdd/01-especificacion-funcional.md`
- Arquitectura y contratos: `docs/sdd/02-arquitectura-y-contratos.md`
- Seguridad y privacidad: `docs/sdd/03-seguridad-y-privacidad.md`
- Plan de pruebas: `docs/sdd/04-plan-de-pruebas.md`
- Operacion y despliegue: `docs/sdd/05-operacion-y-despliegue.md`
- Handoff operativo: `docs/sdd/06-handoff-operativo.md`

## Regla de trabajo

Todo cambio nuevo debe tener:

- Objetivo.
- Alcance.
- Criterios de aceptacion.
- Impacto en datos, seguridad y despliegue.
- Evidencia de verificacion.

## SDD-001 - Gestion integral de productos, categorias y stock

**Estado:** Publicado.

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
- [x] Titulo `FOLLOW THE VIBE` eliminado; se conserva unicamente el enlace visual a Instagram.
- [x] Fondos de categorias corregidos.
- [x] Titulos y descripciones visibles en todas las secciones del catalogo.
- [x] Auditoria mobile completada entre 320 px y 430 px.
- [x] Firma incorporada de forma sutil en footer publico y tablero.
- [x] Footer mobile centrado.

### Implementacion y datos

- [x] Frontend y administrador actualizados.
- [x] Guia operativa documentada en `GUIA_ADMIN_PRODUCTOS.md`.
- [x] Guia de ticketera documentada en `GUIA_CONFIGURACION_TICKETERA.md`.
- [x] Migracion `supabase_migracion_productos_integral.sql` preparada y validada.
- [x] Migracion base ejecutada en Supabase el 2026-08-05.
- [x] Acceso administrativo en produccion confirmado por el responsable el 2026-08-12.
- [ ] Confirmar stock inicial real de Cebolla Morada.

### Verificacion realizada

- [x] Sintaxis de `admin.js` y `main.js` validada con Node.js.
- [x] Estructura de `admin.html` e `index.html` revisada.
- [x] Migracion PostgreSQL base parseada correctamente.
- [x] Catalogo verificado en navegador real a 320 px, 360 px, 390 px y 430 px.
- [x] Version publicada en `main`.

## SDD-002 - Checkout seguro y privacidad

**Estado:** Publicado; migracion aplicada en Supabase el 2026-08-12.

### Especificacion

- Calcular precios, descuentos, cupones y disponibilidad en Supabase.
- Evitar escritura directa publica sobre tablas sensibles.
- Mantener pedidos idempotentes.
- Reducir persistencia de datos personales de invitados.
- Bloquear acceso publico innecesario a clientes, pedidos, cupones, promociones, stock e inventario.

### Criterios de aceptacion

- [x] RPC de cotizacion de carrito instalada.
- [x] RPC de creacion de pedido instalada.
- [x] RPC de menu publico instalada.
- [x] Transiciones de estado administrativas protegidas.
- [x] RLS y grants ajustados.
- [x] Comprobantes locales de invitados con vencimiento de 24 horas.
- [x] Frontend publico sin escrituras directas a tablas sensibles.
- [x] Migracion `supabase_seguridad_checkout.sql` validada por parser PostgreSQL.
- [x] Migracion ejecutada en Supabase por el responsable del proyecto.

### Verificacion realizada

- [x] `node --check main.js`.
- [x] `node --check admin.js`.
- [x] Validacion de librerias JS locales.
- [x] Revision de dependencias runtime externas.
- [x] Revision de credenciales privadas.
- [x] Prueba HTTP local con respuesta 200.

## SDD-003 - Paquete SiteGround

**Estado:** Publicado y subido a GitHub.

### Especificacion

- Entregar sitio estatico listo para `public_html`.
- Incluir assets optimizados, fuentes y librerias locales en una estructura plana.
- Incluir `.htaccess` con seguridad, cache y compresion.
- Documentar pasos de despliegue y rollback.

### Criterios de aceptacion

- [x] `RIOH_SITEGROUND.zip` preparado.
- [x] Copia fechada `RIOH_SITEGROUND_20260812.zip` preparada.
- [x] SHA-256 documentado: `9E6433C2B75BD62D46DB4272FA9B1B720EA039E5DE7F3C444232BF63B584DE72`.
- [x] ZIP verificado contra carpeta de armado.
- [x] Instrucciones actualizadas en `SITEGROUND_INSTRUCCIONES.md`.
- [x] Commit funcional publicado en GitHub: `325d37e`.

## SDD-004 - Incidente de assets ausentes en produccion

**Estado:** Publicado y confirmado en produccion.

### Diagnostico

- El HTML y los archivos principales llegaron a `public_html`.
- SiteGround dejo las dependencias y fuentes en la raiz, pero el HTML las buscaba dentro de `vendor/` y `fonts/`.
- La ruta inexistente `vendor/supabase.min.js` impidio inicializar Supabase, cargar el menu y autenticar el panel.
- La ausencia de las fuentes WOFF2 activo la tipografia de respaldo del navegador.

### Criterios de aceptacion

- [x] El inicio publico evita errores no controlados si no carga el SDK.
- [x] Los recursos locales tienen una nueva version para invalidar cache de errores 404.
- [x] El empaquetado se genera desde una lista cerrada y plana con `scripts/build-siteground.ps1`.
- [x] El empaquetado falla si falta un recurso obligatorio o una ruta no es portable.
- [x] El ZIP corregido fue extraido y validado desde una carpeta limpia.
- [x] `RIOH_SITEGROUND.zip` plano extraido en `public_html`.
- [x] Menu, fuentes y acceso admin confirmados en produccion por el responsable.

## SDD-005 - Reinicio pre-apertura

**Estado:** Consulta preparada; pendiente de ejecucion/confirmacion en Supabase.

### Objetivo

- Iniciar la operacion real con pedidos y metricas en cero.
- Conservar hamburguesas, productos, recetas, precios, imagenes, configuracion e inventario actual.
- Mantener un respaldo privado recuperable de los datos de prueba.

### Criterios de aceptacion

- [x] Consulta `supabase_reinicio_pre_apertura.sql` preparada.
- [x] Respaldo privado previo incluido en la transaccion.
- [x] Verificacion automatica de que `public.productos` no cambia.
- [x] El stock actual queda fuera de las operaciones de reinicio.
- [ ] Consulta ejecutada una sola vez en Supabase.
- [ ] Resultado final confirmado con tres valores en cero.
- [ ] Dashboard y Pedidos verificados vacios.
- [ ] Productos y Gestion Stock verificados sin cambios.

## Pendientes antes de pedidos reales

- [x] Sitio plano publicado y cache actualizado.
- [x] Tienda y admin confirmados funcionando.
- [ ] Ejecutar y confirmar el reinicio pre-apertura.
- [ ] Confirmar que el resultado final muestre pedidos, metricas y movimientos en cero.
- [ ] Confirmar stock inicial real de Cebolla Morada.
- [ ] No crear pedidos de prueba despues del reinicio.
- [ ] Supervisar el primer pedido real y confirmar el descuento de stock.

## SDD-006 - Carrito, WhatsApp y comanda de cocina

**Estado:** Hotfix implementado; pendiente de publicar el paquete.

### Objetivo

- Permitir quitar productos completos desde el carrito.
- Volver a abrir WhatsApp automaticamente al confirmar el pedido.
- Imprimir la comanda con la redaccion solicitada, tipografia de 50 px y sin comprimir horizontalmente el texto.
- Posponer la seleccion de ingredientes incluidos hasta corregir la composicion de cada hamburguesa.

### Criterios de aceptacion

- [x] Cada producto del carrito ofrece una accion explicita `QUITAR ITEM`.
- [x] El selector de ingredientes incluidos queda desactivado para evitar opciones incorrectas.
- [x] Al terminar el pedido la pagina dirige al mensaje prearmado de WhatsApp.
- [x] La comanda usa `NOM`, `HOR`, `DIR`, `PEDIDO`, `TOTAL` y `ALIAS`.
- [x] La comanda abrevia el nombre de la hamburguesa y calcula SIMPLE, DOBLE, TRIPLE o CUADRUPLE.
- [x] El ticket usa Font A doble en ESC/POS y texto de 50 px sin `scaleX` en navegador.
- [x] Redefinir y validar los ingredientes removibles de cada hamburguesa antes de reactivar esa opcion (resuelto en SDD-007).

### Impacto en datos, seguridad y despliegue

- El hotfix del frontend no requiere cambios nuevos en Supabase.
- La restriccion temporal de personalizacion queda reemplazada por la implementacion segura de SDD-007.

### Verificacion realizada

- [x] `node --check main.js`.
- [x] `node --check admin.js`.
- [x] Referencia visual del ticket aprobada.
- [ ] Test de impresion confirmado en la ticketera fisica.

## SDD-007 - Personalizacion, retiro programado y trazabilidad comercial

**Estado:** Implementado y validado localmente; pendiente de ejecutar la migracion y publicar el frontend.

### Objetivo

- Permitir un unico medallon extra solamente en hamburguesas dobles.
- Informar de forma inequivoca que todas las hamburguesas incluyen papas fritas.
- Permitir quitar ingredientes validos de cada receta sin descontarlos del inventario.
- Permitir elegir un horario cuando el pedido es para retirar por el local.
- Identificar cupones, promociones y descuentos en pedidos, metricas, comprobantes y tickets.

### Alcance y criterios de aceptacion

- [x] El control de medallon extra esta bloqueado en SIMPLE y habilitado en DOBLE.
- [x] Cada hamburguesa admite como maximo un medallon extra y el servidor vuelve a validar la regla.
- [x] La inclusion de papas fritas se muestra en catalogo, detalle, carrito, checkout y comprobante.
- [x] El detalle permite marcar ingredientes removibles derivados de la receta vigente.
- [x] Pan, medallon y papas quedan excluidos de la lista de ingredientes removibles.
- [x] Los ingredientes quitados viajan dentro del item, aparecen como `SIN:` y no se consumen del stock.
- [x] La validacion, el descuento y la restauracion de stock usan un bloqueo transaccional compartido.
- [x] RETIRO POR LOCAL muestra un selector obligatorio de horario con turnos de 15 minutos.
- [x] El horario elegido se guarda en el pedido y aparece en la confirmacion y en WhatsApp.
- [x] El checkout devuelve el tipo y nombre del beneficio aplicado.
- [x] El panel resalta el cupon o promocion en kanban, detalle, ventas recientes y ticket.
- [x] Pedidos y dashboard muestran cantidad de pedidos con beneficio, desglose entre cupones/promociones y monto total descontado.
- [x] Una oferta con pedidos historicos se desactiva en lugar de eliminarse para preservar su trazabilidad.

### Impacto en datos, seguridad y despliegue

- Ejecutar primero `supabase_migracion_productos_integral.sql` y despues `supabase_seguridad_checkout.sql`.
- Las RPC seguras vuelven a calcular precios, reglas de extras, ingredientes removibles y horarios del lado servidor.
- Se agregan indices parciales para `pedidos.cupon_id` y `pedidos.promo_id`.
- La publicacion del frontend debe realizarse despues de la migracion para no enviar campos que la RPC anterior desconoce.

### Verificacion realizada

- [x] `node --check main.js` y `node --check admin.js`.
- [x] `git diff --check` sin errores.
- [x] Parser PostgreSQL: 89 sentencias validas en seguridad y 107 en la migracion integral.
- [x] Prueba real de navegador: SIMPLE bloquea el medallon, DOBLE habilita uno y volver a SIMPLE lo elimina.
- [x] Prueba real de navegador: RETIRO POR LOCAL muestra turnos y cambia la etiqueta a HORARIO DE RETIRO.
- [x] Prueba simulada sin escritura: comprobante y ticket muestran cupon, descuento e ingredientes quitados.
- [x] Revision responsive en 375x812 y 812x375 sin desborde horizontal.
- [ ] Ejecutar ambas migraciones en Supabase.
- [ ] Publicar el frontend y purgar cache/CDN.
- [ ] Confirmar un pedido de prueba y cancelarlo para comprobar descuento y restauracion de stock.
- [ ] Confirmar la impresion en la ticketera fisica.
