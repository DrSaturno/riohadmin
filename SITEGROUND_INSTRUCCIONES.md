# Publicacion de RIOH en SiteGround

El archivo `RIOH_SITEGROUND.zip` esta preparado para extraerse directamente dentro de la carpeta `public_html` del dominio.

## Antes de publicar

1. Confirmar que la migracion de Supabase fue ejecutada.
2. Crear el usuario de acceso en **Supabase > Authentication > Users**.
3. Asociar ese usuario a `public.admin_usuarios`.
4. Probar el acceso al panel antes de reemplazar el sitio productivo.

## Pasos

1. En SiteGround, abrir **Site Tools > Site > File Manager**.
2. Entrar a `public_html`.
3. Descargar o comprimir una copia de seguridad de la version actual.
4. Subir `RIOH_SITEGROUND.zip`.
5. Extraer el ZIP dentro de `public_html`.
6. Verificar que `index.html` y `.htaccess` hayan quedado directamente en `public_html`, no dentro de otra subcarpeta.
7. Si SiteGround ofrece cache dinamica, purgarla luego de extraer el paquete.

## Verificacion posterior

1. Abrir la pagina publica en una ventana privada.
2. Confirmar que carguen categorias, productos e imagenes.
3. Abrir `/admin` e iniciar sesion con el email de Supabase Auth.
4. Crear o editar una categoria de prueba y comprobar su orden.
5. Confirmar que un producto con receta muestre disponibilidad por insumos.
6. Realizar una compra de prueba antes de habilitar la operacion normal.

El paquete no incluye archivos SQL, configuracion de Vercel, Git ni archivos de desarrollo.

**Generado:** 2026-08-05

**SHA-256:** `A8D406B3A7357EBDDD60EEF3D26B42CF7C19759C1C46D72C866B98AD6E8B865F`
