# Guia operativa — Administracion de productos

## 1. Categorias

Antes de crear un producto debe existir su categoria.

- **Nombre:** texto visible para el cliente, por ejemplo `Bebidas`.
- **Identificador (slug):** identificador tecnico generado desde el nombre. No se modifica luego de crear la categoria.
- **Tipo de venta — Configurable:** permite elegir variante simple o doble.
- **Tipo de venta — Directo:** agrega el producto al carrito sin elegir simple o doble.
- **Orden:** posicion de la categoria en la tienda. Los numeros menores aparecen primero.
- **Activa:** determina si la categoria y sus productos pueden mostrarse en la tienda.

Se recomienda usar intervalos de diez para poder insertar categorias nuevas sin reordenar todas:

| Categoria | Orden |
|---|---:|
| Hamburguesas | 10 |
| Extras | 20 |
| Bebidas | 30 |
| Postres | 40 |

No conviene repetir el mismo orden en dos categorias.

## 2. Orden de los productos

El campo **Orden dentro de la categoria** sigue la misma regla: el numero menor se muestra primero. Tambien se recomiendan valores `10`, `20`, `30`, etc.

## 3. Stock directo y productos con receta

### Producto sin receta

El campo **Stock/Cantidad** representa las unidades reales disponibles. Al confirmar una venta se descuenta una unidad por cada producto vendido. Cuando llega a cero, el producto queda agotado.

### Producto con receta

Cuando la receta contiene al menos un ingrediente, el campo **Stock/Cantidad** no interviene. Debe dejarse en `0` para evitar confusiones.

La disponibilidad se calcula a partir de los insumos y de la cantidad necesaria de cada uno. El ingrediente que alcance para menos preparaciones determina la cantidad disponible del producto.

Nunca se debe colocar `999` como valor generico. Solo corresponde cargar `999` si existen realmente 999 unidades de un producto sin receta.

## 4. Receta simple y doble

Cada ingrediente tiene dos valores:

- **Simple:** cantidad utilizada por una hamburguesa simple.
- **Mult. doble:** multiplicador aplicado cuando el cliente elige la variante doble.

La formula es:

`Cantidad para doble = Cantidad simple x Mult. doble`

Ejemplo:

| Ingrediente | Simple | Mult. doble | Consumo doble |
|---|---:|---:|---:|
| Medallon | 1 unidad | 2 | 2 unidades |
| Cheddar | 2 fetas | 2 | 4 fetas |
| Pan | 1 unidad | 1 | 1 unidad |
| Salsa | 1 porcion | 1 | 1 porcion |

El sistema no duplica todos los ingredientes automaticamente. Cada multiplicador se configura individualmente.

## 5. Flujo recomendado

1. Crear o revisar los insumos y cargar su stock real.
2. Crear la categoria si todavia no existe.
3. Crear el producto y asignarlo a la categoria.
4. Cargar la receta si el producto consume insumos.
5. Dejar el stock directo en `0` cuando exista una receta.
6. Definir el orden y activar el producto.
7. Verificar en la tienda que aparezca en la posicion esperada y con disponibilidad correcta.

## 6. Acceso administrativo

El panel utiliza Supabase Auth. Para ingresar debe existir:

1. Un usuario creado en **Supabase > Authentication > Users** con email completo y contraseña.
2. El mismo usuario habilitado en `public.admin_usuarios`.

El identificador antiguo `admin` ya no funciona como usuario de acceso.
