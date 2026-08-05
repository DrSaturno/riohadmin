# Guia de configuracion de la ticketera RIOH

**Version:** 1.0

**Fecha:** 2026-08-05

**Sistema de impresion:** QZ Tray + impresora termica ESC/POS de 80 mm

## Importante

La impresora no se conecta directamente a SiteGround. SiteGround solamente aloja la pagina web.

QZ Tray debe instalarse en la computadora del local que esta conectada fisicamente a la ticketera. La configuracion se realiza una vez por cada computadora y navegador que se utilice para administrar pedidos.

## Requisitos

- Computadora del local con Windows, macOS o Linux.
- Impresora termica instalada por USB o red.
- Controlador de la impresora correctamente instalado.
- Impresora compatible con comandos ESC/POS, preferentemente de 80 mm.
- Navegador Chrome o Edge actualizado.
- QZ Tray instalado y abierto.
- Acceso al panel administrativo de RIOH.

## Paso 1 — Instalar y probar la impresora

1. Conectar la impresora termica a la computadora mediante USB o red.
2. Instalar el controlador proporcionado por el fabricante.
3. Abrir la configuracion de impresoras del sistema operativo.
4. Confirmar que la impresora aparezca en la lista.
5. Imprimir una pagina de prueba desde el sistema operativo.

No se debe continuar hasta que la pagina de prueba del sistema operativo se imprima correctamente.

## Paso 2 — Instalar QZ Tray

1. Entrar en [qz.io/download](https://qz.io/download/).
2. Descargar la ultima version estable correspondiente al sistema operativo.
3. Ejecutar el instalador.
4. Aceptar las opciones predeterminadas de instalacion.
5. Abrir QZ Tray.
6. Confirmar que el icono de QZ Tray aparezca junto al reloj o en la barra de aplicaciones del sistema.

QZ Tray 2.1 o superior se inicia automaticamente al ingresar al sistema operativo.

## Paso 3 — Abrir el panel RIOH

1. Desde la misma computadora, abrir el sitio publicado de RIOH.
2. Entrar a la ruta `/admin`.
3. Iniciar sesion con el email completo y la contraseña del usuario creado en Supabase Auth.

El identificador antiguo `admin` no funciona como usuario de acceso.

## Paso 4 — Autorizar la conexion local

Al abrir el panel por primera vez, el navegador puede solicitar permiso para acceder a dispositivos o servicios de la red local.

1. Cuando Chrome o Edge muestre el permiso de red local, seleccionar **Permitir**.
2. No ignorar el aviso repetidamente, porque el navegador puede bloquear la conexion.
3. Cuando QZ Tray pregunte si el sitio RIOH puede conectarse, seleccionar **Allow/Permitir**.
4. Si aparece la opcion **Remember this decision**, marcarla antes de confirmar.

Desde Chrome 147 este permiso es necesario para que un sitio web publico pueda comunicarse con QZ Tray en la computadora local. Referencia: [Local Network Access de QZ Tray](https://qz.io/docs/lna).

## Paso 5 — Conectar la ticketera desde RIOH

1. En la barra superior del administrador, presionar **Ticketera**.
2. Si el indicador aparece rojo, presionar **Reintentar**.
3. Esperar hasta que el panel indique **QZ Tray conectado** y el indicador aparezca verde.
4. Abrir el selector **Impresora seleccionada**.
5. Elegir el nombre exacto de la ticketera instalada en el sistema operativo.
6. Presionar **Guardar**.

La seleccion queda almacenada en ese navegador y computadora. Si se cambia de navegador, se usa otra computadora o se borran los datos del navegador, sera necesario seleccionar la impresora nuevamente.

## Paso 6 — Imprimir el ticket de prueba

1. Comprobar que haya papel colocado correctamente.
2. Desde la configuracion de Ticketera, presionar **Test Ticket**.
3. Aceptar el aviso de QZ Tray si aparece.
4. Verificar que el ticket tenga texto legible, avance de papel y corte.

Si el ticket se imprime correctamente, la configuracion esta terminada.

## Uso cotidiano

Antes de comenzar la jornada:

1. Encender la impresora.
2. Confirmar que tenga papel.
3. Confirmar que QZ Tray este abierto.
4. Entrar al panel RIOH.
5. Verificar que el indicador **Ticketera** aparezca verde.

Durante la operacion:

- Al confirmar el pago de un pedido, el sistema envia el ticket a la impresora seleccionada.
- Un ticket puede reimprimirse con el boton de impresora que aparece en cada comanda.
- Si QZ Tray esta desconectado, se abre una ventana de impresion tradicional del navegador.

## Resolucion de problemas

### QZ Tray aparece desconectado

1. Confirmar que QZ Tray este abierto.
2. Abrir `https://localhost:8181` en el navegador.
3. Si aparece una advertencia del certificado local, entrar en **Avanzado** y seleccionar **Continuar**.
4. Volver al panel RIOH.
5. Recargar la pagina.
6. Abrir **Ticketera** y presionar **Reintentar**.

Tambien puede probarse la instalacion desde [demo.qz.io](https://demo.qz.io), siguiendo la [guia oficial de uso](https://qz.io/docs/using-qz-tray).

### La impresora no aparece en el selector

1. Confirmar que aparezca en las impresoras del sistema operativo.
2. Imprimir una pagina de prueba desde el sistema.
3. Cerrar y volver a abrir QZ Tray.
4. Recargar el panel RIOH.
5. Presionar **Reintentar**.

### Imprime simbolos o texto incorrecto

- Confirmar que la impresora sea compatible con ESC/POS.
- Revisar el controlador instalado.
- Confirmar que no este configurada en un lenguaje diferente, como ZPL.
- Consultar al proveedor para activar el modo ESC/POS.

### No abre la ventana alternativa de impresion

1. Abrir la configuracion del sitio en el navegador.
2. Permitir ventanas emergentes para el dominio de RIOH.
3. Volver a presionar el boton de impresion.

### Se cambio de computadora o navegador

QZ Tray y la impresora deben configurarse nuevamente en cada computadora. La impresora seleccionada se guarda localmente, no en Supabase ni en SiteGround.

## Avisos de seguridad de QZ Tray

La integracion actual utiliza solicitudes sin firma digital. La impresion funciona, pero QZ Tray puede mostrar advertencias de autorizacion.

Para eliminar completamente los avisos y conseguir impresion silenciosa certificada es necesario implementar firma digital de las solicitudes. Referencia: [firma digital de QZ Tray](https://qz.io/docs/signing).

## Checklist final

- [ ] La impresora imprime una pagina de prueba desde el sistema operativo.
- [ ] QZ Tray esta instalado y abierto.
- [ ] El navegador tiene permitido el acceso a la red local.
- [ ] QZ Tray autorizo el sitio de RIOH.
- [ ] El indicador Ticketera aparece verde.
- [ ] La impresora correcta esta seleccionada y guardada.
- [ ] Test Ticket se imprime correctamente.
- [ ] Se probo la impresion desde una comanda real.
