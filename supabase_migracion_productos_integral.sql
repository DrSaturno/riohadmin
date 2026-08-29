-- ============================================================================
-- RIOH.ADMIN - Migracion integral de productos, categorias, stock y seguridad
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Es idempotente: se puede volver a ejecutar si una seccion falla.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Campos de checkout requeridos por el frontend actual
-- ---------------------------------------------------------------------------

-- El checkout admite invitados sin email y conserva los datos de entrega
-- utilizados en cada pedido.
ALTER TABLE public.clientes
    ALTER COLUMN email DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS timbre text;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS timbre text,
    ADD COLUMN IF NOT EXISTS nota text,
    ADD COLUMN IF NOT EXISTS entrega_programada timestamptz;

CREATE INDEX IF NOT EXISTS pedidos_entrega_programada_idx
    ON public.pedidos (entrega_programada)
    WHERE entrega_programada IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1. Categorias administrables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categorias_productos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    nombre text NOT NULL,
    descripcion text,
    tipo_venta text NOT NULL DEFAULT 'directo'
        CHECK (tipo_venta IN ('configurable', 'directo')),
    orden integer NOT NULL DEFAULT 0 CHECK (orden >= 0),
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT categorias_productos_slug_formato
        CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE OR REPLACE FUNCTION public.actualizar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categorias_productos_updated_at ON public.categorias_productos;
CREATE TRIGGER categorias_productos_updated_at
BEFORE UPDATE ON public.categorias_productos
FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

INSERT INTO public.categorias_productos (slug, nombre, descripcion, tipo_venta, orden, activo)
VALUES
    ('burgers', 'Hamburguesas', 'Hamburguesas con variantes simple y doble.', 'configurable', 10, true),
    ('extras', 'Extras', 'Acompañamientos que se agregan directamente al pedido.', 'directo', 20, true)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.productos
    ADD COLUMN IF NOT EXISTS orden integer NOT NULL DEFAULT 0;

UPDATE public.productos
SET categoria = trim(both '-' FROM regexp_replace(
    translate(lower(coalesce(nullif(trim(categoria), ''), 'burgers')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '-', 'g'
));

UPDATE public.productos
SET categoria = 'burgers'
WHERE categoria IS NULL OR categoria = '';

-- Conserva cualquier categoria historica que no sea burgers/extras.
INSERT INTO public.categorias_productos (slug, nombre, tipo_venta, orden, activo)
SELECT DISTINCT
    p.categoria,
    initcap(replace(p.categoria, '-', ' ')),
    'directo',
    100,
    true
FROM public.productos p
WHERE p.categoria IS NOT NULL
  AND p.categoria ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.productos'::regclass
          AND conname = 'productos_categoria_fkey'
    ) THEN
        ALTER TABLE public.productos
            ADD CONSTRAINT productos_categoria_fkey
            FOREIGN KEY (categoria)
            REFERENCES public.categorias_productos(slug)
            ON UPDATE CASCADE
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

ALTER TABLE public.productos VALIDATE CONSTRAINT productos_categoria_fkey;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.productos'::regclass
          AND conname = 'productos_precios_no_negativos'
    ) THEN
        ALTER TABLE public.productos
            ADD CONSTRAINT productos_precios_no_negativos
            CHECK (
                coalesce(precio_simple, 0) >= 0
                AND coalesce(precio_doble, 0) >= 0
                AND coalesce(stock, 0) >= 0
                AND coalesce(orden, 0) >= 0
            ) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.productos VALIDATE CONSTRAINT productos_precios_no_negativos;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.insumos'::regclass
          AND conname = 'insumos_stock_no_negativo'
    ) THEN
        ALTER TABLE public.insumos
            ADD CONSTRAINT insumos_stock_no_negativo
            CHECK (coalesce(stock_actual, 0) >= 0 AND coalesce(stock_minimo, 0) >= 0)
            NOT VALID;
    END IF;
END $$;

ALTER TABLE public.insumos VALIDATE CONSTRAINT insumos_stock_no_negativo;

CREATE INDEX IF NOT EXISTS productos_categoria_orden_idx
    ON public.productos (categoria, orden, created_at);

-- ---------------------------------------------------------------------------
-- 2. Administradores autenticados con Supabase Auth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_usuarios (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.admin_usuarios au
        WHERE au.user_id = auth.uid()
          AND au.activo = true
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Integridad de recetas e inventario
-- ---------------------------------------------------------------------------

-- La receta actual de Fresh Bloom referencia este UUID. Se crea en cero para
-- que el administrador cargue la existencia real desde Gestion Stock.
INSERT INTO public.insumos (id, nombre, unidad, stock_actual, stock_minimo)
VALUES (
    '055c55b9-8ea2-4f02-ac9f-beb4ac459b9f'::uuid,
    'Cebolla Morada',
    'unidades',
    0,
    5
)
ON CONFLICT DO NOTHING;

-- La porcion de papas se descuenta en kg: 200 g equivalen a 0.2 kg.
-- Se incluye aqui para evitar ejecutar sql_recetas_final.sql por separado.
UPDATE public.productos
SET receta = jsonb_build_object(
    'ingredientes', jsonb_build_array(
        jsonb_build_object(
            'ingrediente_id', 'fa0963b7-6a1c-4756-a93d-23dbc8a332ee',
            'nombre', 'Papas Baston (Crudas)',
            'unidad', 'kg',
            'cantidad', 0.2
        )
    )
)
WHERE id = '309efc41-f023-4323-a038-7751ea4347aa'::uuid;

CREATE TABLE IF NOT EXISTS public.extras_inventario (
    nombre_extra text PRIMARY KEY,
    ingrediente_id uuid NOT NULL REFERENCES public.insumos(id) ON DELETE RESTRICT,
    cantidad numeric NOT NULL CHECK (cantidad > 0),
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Ledger inmutable: permite restaurar exactamente lo descontado aunque luego
-- cambien una receta o el mapeo de un extra.
CREATE TABLE IF NOT EXISTS public.movimientos_stock_pedido (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
    tipo text NOT NULL CHECK (tipo IN ('insumo', 'producto')),
    referencia_id uuid NOT NULL,
    cantidad numeric NOT NULL CHECK (cantidad <> 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    restaurado_at timestamptz
);

ALTER TABLE public.movimientos_stock_pedido
    DROP CONSTRAINT IF EXISTS movimientos_stock_pedido_cantidad_check,
    DROP CONSTRAINT IF EXISTS movimientos_stock_pedido_cantidad_no_cero_check;
ALTER TABLE public.movimientos_stock_pedido
    ADD CONSTRAINT movimientos_stock_pedido_cantidad_no_cero_check CHECK (cantidad <> 0);

CREATE INDEX IF NOT EXISTS movimientos_stock_pedido_activos_idx
    ON public.movimientos_stock_pedido (pedido_id, tipo, referencia_id)
    WHERE restaurado_at IS NULL;

INSERT INTO public.extras_inventario (nombre_extra, ingrediente_id, cantidad)
SELECT 'Medallón Extra', i.id, 1
FROM public.insumos i
WHERE lower(i.nombre) LIKE '%medall%n%'
ORDER BY i.nombre
LIMIT 1
ON CONFLICT (nombre_extra) DO NOTHING;

INSERT INTO public.extras_inventario (nombre_extra, ingrediente_id, cantidad)
SELECT 'Extra Cheddar', i.id, 2
FROM public.insumos i
WHERE lower(i.nombre) LIKE '%cheddar%'
ORDER BY i.nombre
LIMIT 1
ON CONFLICT (nombre_extra) DO NOTHING;

INSERT INTO public.extras_inventario (nombre_extra, ingrediente_id, cantidad)
SELECT 'Extra Bacon', i.id, 2
FROM public.insumos i
WHERE lower(i.nombre) LIKE '%panceta%'
ORDER BY i.nombre
LIMIT 1
ON CONFLICT (nombre_extra) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validar_receta_producto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ingrediente jsonb;
    v_id uuid;
    v_cantidad numeric;
    v_doble_mult numeric;
BEGIN
    IF NEW.receta IS NULL OR jsonb_typeof(NEW.receta) = 'null' THEN
        RETURN NEW;
    END IF;

    IF jsonb_typeof(NEW.receta) <> 'object'
       OR jsonb_typeof(coalesce(NEW.receta->'ingredientes', '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'La receta debe contener un arreglo "ingredientes".';
    END IF;

    FOR v_ingrediente IN
        SELECT value
        FROM jsonb_array_elements(coalesce(NEW.receta->'ingredientes', '[]'::jsonb))
    LOOP
        BEGIN
            v_id := (v_ingrediente->>'ingrediente_id')::uuid;
            v_cantidad := (v_ingrediente->>'cantidad')::numeric;
            v_doble_mult := coalesce(nullif(v_ingrediente->>'doble_mult', '')::numeric, 1);
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Ingrediente de receta invalido: %', v_ingrediente;
        END;

        IF v_cantidad <= 0 OR v_doble_mult <= 0 THEN
            RAISE EXCEPTION 'Cantidad y multiplicador doble deben ser mayores que cero.';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.insumos WHERE id = v_id) THEN
            RAISE EXCEPTION 'La receta referencia un insumo inexistente: %', v_id;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS productos_validar_receta ON public.productos;
CREATE TRIGGER productos_validar_receta
BEFORE INSERT OR UPDATE OF receta ON public.productos
FOR EACH ROW EXECUTE FUNCTION public.validar_receta_producto();

CREATE OR REPLACE FUNCTION public.impedir_borrado_insumo_en_uso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.productos p
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(coalesce(p.receta->'ingredientes', '[]'::jsonb)) = 'array'
                    THEN coalesce(p.receta->'ingredientes', '[]'::jsonb)
                ELSE '[]'::jsonb
            END
        ) ingrediente
        WHERE ingrediente->>'ingrediente_id' = OLD.id::text
    ) OR EXISTS (
        SELECT 1 FROM public.movimientos_stock_pedido m
        WHERE m.tipo = 'insumo' AND m.referencia_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'No se puede eliminar "%": esta usado por recetas o movimientos historicos.', OLD.nombre;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS insumos_impedir_borrado_en_uso ON public.insumos;
CREATE TRIGGER insumos_impedir_borrado_en_uso
BEFORE DELETE ON public.insumos
FOR EACH ROW EXECUTE FUNCTION public.impedir_borrado_insumo_en_uso();

CREATE OR REPLACE FUNCTION public.impedir_borrado_producto_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.pedidos pe
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(coalesce(pe.items, '[]'::jsonb)) = 'array'
                    THEN coalesce(pe.items, '[]'::jsonb)
                ELSE '[]'::jsonb
            END
        ) item
        WHERE item->>'product_id' = OLD.id::text
    ) THEN
        RAISE EXCEPTION 'No se puede eliminar "%": tiene pedidos asociados. Desactivalo.', OLD.nombre;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS productos_impedir_borrado_pendiente ON public.productos;
CREATE TRIGGER productos_impedir_borrado_pendiente
BEFORE DELETE ON public.productos
FOR EACH ROW EXECUTE FUNCTION public.impedir_borrado_producto_pendiente();

-- ---------------------------------------------------------------------------
-- 4. Movimiento de stock transaccional
-- ---------------------------------------------------------------------------

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS stock_descontado boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS estado_pendiente_original text,
    ADD COLUMN IF NOT EXISTS cancelado_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancelado_motivo text,
    ADD COLUMN IF NOT EXISTS cancelado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public._aplicar_movimiento_stock(
    p_items jsonb,
    p_signo integer,
    p_pedido_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item jsonb;
    v_producto public.productos%ROWTYPE;
    v_producto_id uuid;
    v_item_qty integer;
    v_es_doble boolean;
    v_receta_item jsonb;
    v_ingrediente_id uuid;
    v_necesario numeric;
    v_actualizado uuid;
    v_nombre text;
    v_stock numeric;
    v_extra jsonb;
    v_extra_nombre text;
    v_extra_qty integer;
    v_extra_map record;
BEGIN
    -- El volumen del local permite serializar movimientos. Evita deadlocks y
    -- carreras entre dos confirmaciones con ingredientes compartidos.
    PERFORM pg_advisory_xact_lock(hashtext('rioh_inventory_movement'));

    IF p_signo NOT IN (-1, 1) THEN
        RAISE EXCEPTION 'Movimiento de stock invalido.';
    END IF;
    IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0
       OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 100 THEN
        RAISE EXCEPTION 'Los items del pedido no son validos.';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    LOOP
        BEGIN
            IF coalesce(v_item->>'qty', '1') !~ '^[1-9][0-9]*$' THEN
                RAISE EXCEPTION 'Cantidad invalida.';
            END IF;
            v_producto_id := (v_item->>'product_id')::uuid;
            v_item_qty := coalesce((v_item->>'qty')::integer, 1);
            IF v_item_qty > 100 THEN RAISE EXCEPTION 'Cantidad maxima por item: 100.'; END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Item de pedido invalido: %', v_item;
        END;

        SELECT * INTO v_producto
        FROM public.productos
        WHERE id = v_producto_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto inexistente: %', v_producto_id;
        END IF;
        IF p_signo = -1 AND v_producto.activo IS NOT TRUE THEN
            RAISE EXCEPTION 'El producto "%" esta inactivo.', v_producto.nombre;
        END IF;
        IF p_signo = -1 AND NOT EXISTS (
            SELECT 1 FROM public.categorias_productos c
            WHERE c.slug = v_producto.categoria AND c.activo = true
        ) THEN
            RAISE EXCEPTION 'La categoria del producto "%" esta inactiva.', v_producto.nombre;
        END IF;

        v_es_doble := lower(coalesce(v_item->>'type', '')) = 'doble';

        IF jsonb_typeof(coalesce(v_producto.receta->'ingredientes', '[]'::jsonb)) = 'array'
           AND jsonb_array_length(coalesce(v_producto.receta->'ingredientes', '[]'::jsonb)) > 0 THEN
            FOR v_receta_item IN
                SELECT value
                FROM jsonb_array_elements(v_producto.receta->'ingredientes')
            LOOP
                v_ingrediente_id := (v_receta_item->>'ingrediente_id')::uuid;
                v_necesario := (v_receta_item->>'cantidad')::numeric
                    * CASE
                        WHEN v_es_doble
                            THEN coalesce(nullif(v_receta_item->>'doble_mult', '')::numeric, 1)
                        ELSE 1
                      END
                    * v_item_qty;

                v_actualizado := NULL;
                IF p_signo = -1 THEN
                    UPDATE public.insumos
                    SET stock_actual = stock_actual - v_necesario
                    WHERE id = v_ingrediente_id
                      AND stock_actual >= v_necesario
                    RETURNING id INTO v_actualizado;
                    IF v_actualizado IS NULL THEN
                        SELECT nombre, stock_actual INTO v_nombre, v_stock
                        FROM public.insumos WHERE id = v_ingrediente_id;
                        RAISE EXCEPTION 'Stock insuficiente de % (disponible %, necesario %).',
                            coalesce(v_nombre, v_ingrediente_id::text), coalesce(v_stock, 0), v_necesario;
                    END IF;
                    IF p_pedido_id IS NOT NULL THEN
                        INSERT INTO public.movimientos_stock_pedido
                            (pedido_id, tipo, referencia_id, cantidad)
                        VALUES (p_pedido_id, 'insumo', v_ingrediente_id, v_necesario);
                    END IF;
                ELSE
                    UPDATE public.insumos
                    SET stock_actual = stock_actual + v_necesario
                    WHERE id = v_ingrediente_id
                    RETURNING id INTO v_actualizado;
                    IF v_actualizado IS NULL THEN
                        RAISE EXCEPTION 'No se pudo restaurar el insumo %.', v_ingrediente_id;
                    END IF;
                END IF;
            END LOOP;
        ELSE
            v_actualizado := NULL;
            IF p_signo = -1 THEN
                UPDATE public.productos
                SET stock = stock - v_item_qty
                WHERE id = v_producto_id
                  AND coalesce(stock, 0) >= v_item_qty
                RETURNING id INTO v_actualizado;
                IF v_actualizado IS NULL THEN
                    RAISE EXCEPTION 'Stock insuficiente de %.', v_producto.nombre;
                END IF;
                IF p_pedido_id IS NOT NULL THEN
                    INSERT INTO public.movimientos_stock_pedido
                        (pedido_id, tipo, referencia_id, cantidad)
                    VALUES (p_pedido_id, 'producto', v_producto_id, v_item_qty);
                END IF;
            ELSE
                UPDATE public.productos
                SET stock = coalesce(stock, 0) + v_item_qty
                WHERE id = v_producto_id
                RETURNING id INTO v_actualizado;
            END IF;
        END IF;

        IF v_item ? 'extras'
           AND jsonb_typeof(coalesce(v_item->'extras', '[]'::jsonb)) <> 'array' THEN
            RAISE EXCEPTION 'Los extras del item no son validos.';
        END IF;

        IF jsonb_typeof(coalesce(v_item->'extras', '[]'::jsonb)) = 'array' THEN
            IF jsonb_array_length(coalesce(v_item->'extras', '[]'::jsonb)) > 20 THEN
                RAISE EXCEPTION 'Demasiados extras en un item.';
            END IF;
            FOR v_extra IN SELECT value FROM jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb))
            LOOP
                IF jsonb_typeof(v_extra) = 'string' THEN
                    v_extra_nombre := v_extra #>> '{}';
                    v_extra_qty := 1;
                ELSE
                    v_extra_nombre := v_extra->>'name';
                    IF coalesce(v_extra->>'qty', '1') !~ '^[1-9][0-9]*$' THEN
                        RAISE EXCEPTION 'Cantidad invalida para el extra "%".', v_extra_nombre;
                    END IF;
                    v_extra_qty := coalesce((v_extra->>'qty')::integer, 1);
                END IF;

                SELECT ei.ingrediente_id, ei.cantidad
                INTO v_extra_map
                FROM public.extras_inventario ei
                WHERE lower(ei.nombre_extra) = lower(v_extra_nombre)
                  AND (p_signo = 1 OR ei.activo = true);

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'El extra "%" no tiene una regla de inventario activa.', v_extra_nombre;
                END IF;

                v_necesario := v_extra_map.cantidad * v_extra_qty * v_item_qty;
                v_actualizado := NULL;
                IF p_signo = -1 THEN
                    UPDATE public.insumos
                    SET stock_actual = stock_actual - v_necesario
                    WHERE id = v_extra_map.ingrediente_id
                      AND stock_actual >= v_necesario
                    RETURNING id INTO v_actualizado;
                    IF v_actualizado IS NULL THEN
                        SELECT nombre, stock_actual INTO v_nombre, v_stock
                        FROM public.insumos WHERE id = v_extra_map.ingrediente_id;
                        RAISE EXCEPTION 'Stock insuficiente de % para el extra %.',
                            coalesce(v_nombre, v_extra_nombre), v_extra_nombre;
                    END IF;
                    IF p_pedido_id IS NOT NULL THEN
                        INSERT INTO public.movimientos_stock_pedido
                            (pedido_id, tipo, referencia_id, cantidad)
                        VALUES (p_pedido_id, 'insumo', v_extra_map.ingrediente_id, v_necesario);
                    END IF;
                ELSE
                    UPDATE public.insumos
                    SET stock_actual = stock_actual + v_necesario
                    WHERE id = v_extra_map.ingrediente_id
                    RETURNING id INTO v_actualizado;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._compensar_ingredientes_quitados(
    p_items jsonb,
    p_signo integer,
    p_pedido_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item jsonb;
    v_producto public.productos%ROWTYPE;
    v_receta_item jsonb;
    v_item_qty integer;
    v_es_doble boolean;
    v_ingrediente_id uuid;
    v_compensacion numeric;
    v_actualizado uuid;
BEGIN
    -- Usa el mismo bloqueo transaccional que _aplicar_movimiento_stock para que
    -- la compensacion previa nunca sea visible como stock real para otro pedido.
    PERFORM pg_advisory_xact_lock(hashtext('rioh_inventory_movement'));

    IF p_signo NOT IN (-1, 1) THEN
        RAISE EXCEPTION 'Movimiento de compensacion invalido.';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    LOOP
        IF jsonb_typeof(coalesce(v_item->'removedIngredients', '[]'::jsonb)) <> 'array'
           OR jsonb_array_length(coalesce(v_item->'removedIngredients', '[]'::jsonb)) = 0 THEN
            CONTINUE;
        END IF;

        v_item_qty := greatest(1, coalesce((v_item->>'qty')::integer, 1));
        v_es_doble := lower(coalesce(v_item->>'type', '')) = 'doble';
        SELECT * INTO v_producto
        FROM public.productos
        WHERE id = (v_item->>'product_id')::uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se pudo compensar un producto inexistente.';
        END IF;

        FOR v_receta_item IN
            SELECT recipe_value
            FROM jsonb_array_elements(
                CASE
                    WHEN jsonb_typeof(coalesce(v_producto.receta->'ingredientes', '[]'::jsonb)) = 'array'
                        THEN coalesce(v_producto.receta->'ingredientes', '[]'::jsonb)
                    ELSE '[]'::jsonb
                END
            ) AS recipe_entry(recipe_value)
            WHERE EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(v_item->'removedIngredients') AS removed_entry(removed_name)
                WHERE lower(trim(removed_name)) = lower(trim(coalesce(recipe_value->>'nombre', '')))
            )
        LOOP
            v_ingrediente_id := (v_receta_item->>'ingrediente_id')::uuid;
            v_compensacion := (v_receta_item->>'cantidad')::numeric
                * CASE
                    WHEN v_es_doble
                        THEN coalesce(nullif(v_receta_item->>'doble_mult', '')::numeric, 1)
                    ELSE 1
                  END
                * v_item_qty;

            v_actualizado := NULL;
            IF p_signo = -1 THEN
                UPDATE public.insumos
                SET stock_actual = stock_actual + v_compensacion
                WHERE id = v_ingrediente_id
                RETURNING id INTO v_actualizado;
            ELSE
                UPDATE public.insumos
                SET stock_actual = stock_actual - v_compensacion
                WHERE id = v_ingrediente_id
                  AND stock_actual >= v_compensacion
                RETURNING id INTO v_actualizado;
            END IF;
            IF v_actualizado IS NULL THEN
                RAISE EXCEPTION 'No se pudo compensar el ingrediente %.', v_ingrediente_id;
            END IF;

            IF p_pedido_id IS NOT NULL AND p_signo = -1 THEN
                INSERT INTO public.movimientos_stock_pedido
                    (pedido_id, tipo, referencia_id, cantidad)
                VALUES (p_pedido_id, 'insumo', v_ingrediente_id, -v_compensacion);
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._restaurar_stock_pedido(
    p_pedido_id uuid,
    p_items_legacy jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_movimiento record;
    v_hay_movimientos boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('rioh_inventory_movement'));

    SELECT EXISTS (
        SELECT 1 FROM public.movimientos_stock_pedido
        WHERE pedido_id = p_pedido_id AND restaurado_at IS NULL
    ) INTO v_hay_movimientos;

    IF NOT v_hay_movimientos THEN
        -- Compatibilidad con pedidos aprobados antes de instalar esta migracion.
        PERFORM public._aplicar_movimiento_stock(p_items_legacy, 1, NULL);
        PERFORM public._compensar_ingredientes_quitados(p_items_legacy, 1, NULL);
        RETURN;
    END IF;

    FOR v_movimiento IN
        SELECT tipo, referencia_id, sum(cantidad) AS cantidad
        FROM public.movimientos_stock_pedido
        WHERE pedido_id = p_pedido_id AND restaurado_at IS NULL
        GROUP BY tipo, referencia_id
        ORDER BY tipo, referencia_id
    LOOP
        IF v_movimiento.tipo = 'insumo' THEN
            UPDATE public.insumos
            SET stock_actual = stock_actual + v_movimiento.cantidad
            WHERE id = v_movimiento.referencia_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'No se pudo restaurar el insumo %.', v_movimiento.referencia_id;
            END IF;
        ELSE
            UPDATE public.productos
            SET stock = coalesce(stock, 0) + v_movimiento.cantidad::integer
            WHERE id = v_movimiento.referencia_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'No se pudo restaurar el producto %.', v_movimiento.referencia_id;
            END IF;
        END IF;
    END LOOP;

    UPDATE public.movimientos_stock_pedido
    SET restaurado_at = now()
    WHERE pedido_id = p_pedido_id AND restaurado_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_stock_carrito(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_error text;
BEGIN
    BEGIN
        PERFORM public._compensar_ingredientes_quitados(p_items, -1, NULL);
        PERFORM public._aplicar_movimiento_stock(p_items, -1, NULL);
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = '__VALIDACION_OK__';
    EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
            RETURN jsonb_build_object('ok', true);
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
            RETURN jsonb_build_object('ok', false, 'error', v_error);
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.avanzar_pedido_seguro(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_siguiente text;
    v_desconto boolean := false;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Acceso de administrador requerido.';
    END IF;

    SELECT * INTO v_pedido
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;

    v_siguiente := CASE v_pedido.estado_pago
        WHEN 'pendiente' THEN 'aprobado'
        WHEN 'pendiente_efectivo' THEN 'aprobado'
        WHEN 'pendiente_transferencia' THEN 'aprobado'
        WHEN 'aprobado' THEN 'preparacion'
        WHEN 'preparacion' THEN 'entregado'
        ELSE NULL
    END;
    IF v_siguiente IS NULL THEN RAISE EXCEPTION 'El pedido no puede avanzar desde %.', v_pedido.estado_pago; END IF;

    IF v_pedido.estado_pago IN ('pendiente', 'pendiente_efectivo', 'pendiente_transferencia')
       AND coalesce(v_pedido.stock_descontado, false) = false THEN
        PERFORM public._compensar_ingredientes_quitados(v_pedido.items, -1, p_pedido_id);
        PERFORM public._aplicar_movimiento_stock(v_pedido.items, -1, p_pedido_id);
        v_desconto := true;
    END IF;

    IF v_pedido.estado_pago = 'aprobado'
       AND coalesce(v_pedido.stock_descontado, false) = false THEN
        RAISE EXCEPTION 'Pedido aprobado sin stock descontado: requiere conciliacion manual.';
    END IF;

    UPDATE public.pedidos
    SET estado_pago = v_siguiente,
        stock_descontado = CASE WHEN v_desconto THEN true ELSE stock_descontado END,
        estado_pendiente_original = CASE
            WHEN v_desconto THEN v_pedido.estado_pago
            ELSE estado_pendiente_original
        END
    WHERE id = p_pedido_id;

    RETURN jsonb_build_object(
        'estado_anterior', v_pedido.estado_pago,
        'estado', v_siguiente,
        'stock_descontado_ahora', v_desconto
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.retroceder_pedido_seguro(p_pedido_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_anterior text;
    v_reintegro boolean := false;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Acceso de administrador requerido.';
    END IF;

    SELECT * INTO v_pedido
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;

    v_anterior := CASE v_pedido.estado_pago
        WHEN 'aprobado' THEN coalesce(v_pedido.estado_pendiente_original, 'pendiente')
        WHEN 'preparacion' THEN 'aprobado'
        WHEN 'entregado' THEN 'preparacion'
        ELSE NULL
    END;
    IF v_anterior IS NULL THEN RAISE EXCEPTION 'El pedido no puede retroceder desde %.', v_pedido.estado_pago; END IF;

    IF v_pedido.estado_pago = 'aprobado' AND coalesce(v_pedido.stock_descontado, false) THEN
        PERFORM public._restaurar_stock_pedido(p_pedido_id, v_pedido.items);
        v_reintegro := true;
    END IF;

    UPDATE public.pedidos
    SET estado_pago = v_anterior,
        stock_descontado = CASE WHEN v_reintegro THEN false ELSE stock_descontado END
    WHERE id = p_pedido_id;

    RETURN jsonb_build_object('estado', v_anterior, 'stock_reintegrado', v_reintegro);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_pedido_seguro(
    p_pedido_id uuid,
    p_motivo text DEFAULT 'Cancelado desde el panel'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_reintegro boolean := false;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Acceso de administrador requerido.';
    END IF;

    SELECT * INTO v_pedido
    FROM public.pedidos
    WHERE id = p_pedido_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;
    IF v_pedido.estado_pago = 'cancelado' THEN RAISE EXCEPTION 'El pedido ya esta cancelado.'; END IF;

    IF coalesce(v_pedido.stock_descontado, false) THEN
        PERFORM public._restaurar_stock_pedido(p_pedido_id, v_pedido.items);
        v_reintegro := true;
    END IF;

    UPDATE public.pedidos
    SET estado_pago = 'cancelado',
        stock_descontado = false,
        cancelado_at = now(),
        cancelado_motivo = nullif(trim(p_motivo), ''),
        cancelado_por = auth.uid()
    WHERE id = p_pedido_id;

    IF v_pedido.cliente_id IS NOT NULL THEN
        UPDATE public.clientes
        SET pedidos_count = greatest(0, coalesce(pedidos_count, 0) - 1),
            total_gastado = greatest(0, coalesce(total_gastado, 0) - coalesce(v_pedido.total, 0))
        WHERE id = v_pedido.cliente_id;
    END IF;

    IF v_pedido.cupon_id IS NOT NULL THEN
        UPDATE public.cupones
        SET usos_actuales = greatest(0, coalesce(usos_actuales, 0) - 1)
        WHERE id = v_pedido.cupon_id;
    END IF;

    RETURN jsonb_build_object('cancelado', true, 'stock_reintegrado', v_reintegro);
END;
$$;

REVOKE ALL ON FUNCTION public._aplicar_movimiento_stock(jsonb, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._compensar_ingredientes_quitados(jsonb, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._restaurar_stock_pedido(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_stock_carrito(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avanzar_pedido_seguro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retroceder_pedido_seguro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_pedido_seguro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validar_stock_carrito(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avanzar_pedido_seguro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retroceder_pedido_seguro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_seguro(uuid, text) TO authenticated;

-- El checkout conserva INSERT/SELECT segun sus politicas actuales, pero ninguna
-- sesion cliente puede cambiar estados ni borrar pedidos por fuera de las RPC.
REVOKE UPDATE, DELETE ON public.pedidos FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS: lectura publica, escritura solo de administradores
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extras_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_stock_pedido ENABLE ROW LEVEL SECURITY;

-- Elimina politicas permisivas anteriores solamente en las tablas de inventario.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('admin_usuarios', 'categorias_productos', 'productos', 'insumos', 'extras_inventario', 'movimientos_stock_pedido')
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
END $$;

CREATE POLICY admin_usuarios_ver_propio
ON public.admin_usuarios FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY categorias_lectura_publica
ON public.categorias_productos FOR SELECT TO anon, authenticated
USING (activo = true OR public.es_admin());
CREATE POLICY categorias_admin_insertar
ON public.categorias_productos FOR INSERT TO authenticated
WITH CHECK (public.es_admin());
CREATE POLICY categorias_admin_actualizar
ON public.categorias_productos FOR UPDATE TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());
CREATE POLICY categorias_admin_eliminar
ON public.categorias_productos FOR DELETE TO authenticated
USING (public.es_admin());

CREATE POLICY productos_lectura_publica
ON public.productos FOR SELECT TO anon, authenticated
USING (activo = true OR public.es_admin());
CREATE POLICY productos_admin_insertar
ON public.productos FOR INSERT TO authenticated
WITH CHECK (public.es_admin());
CREATE POLICY productos_admin_actualizar
ON public.productos FOR UPDATE TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());
CREATE POLICY productos_admin_eliminar
ON public.productos FOR DELETE TO authenticated
USING (public.es_admin());

CREATE POLICY insumos_lectura_publica
ON public.insumos FOR SELECT TO anon, authenticated
USING (true);
CREATE POLICY insumos_admin_insertar
ON public.insumos FOR INSERT TO authenticated
WITH CHECK (public.es_admin());
CREATE POLICY insumos_admin_actualizar
ON public.insumos FOR UPDATE TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());
CREATE POLICY insumos_admin_eliminar
ON public.insumos FOR DELETE TO authenticated
USING (public.es_admin());

CREATE POLICY extras_inventario_lectura
ON public.extras_inventario FOR SELECT TO anon, authenticated
USING (activo = true OR public.es_admin());
CREATE POLICY extras_inventario_admin
ON public.extras_inventario FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY movimientos_stock_admin
ON public.movimientos_stock_pedido FOR SELECT TO authenticated
USING (public.es_admin());

REVOKE INSERT, UPDATE, DELETE ON public.categorias_productos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.productos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.insumos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.extras_inventario FROM anon;
REVOKE ALL ON public.admin_usuarios FROM anon;
REVOKE ALL ON public.movimientos_stock_pedido FROM anon;

GRANT SELECT ON public.categorias_productos, public.productos, public.insumos, public.extras_inventario TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias_productos, public.productos, public.insumos, public.extras_inventario TO authenticated;
GRANT SELECT ON public.admin_usuarios, public.movimientos_stock_pedido TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storage de imagenes: bucket publico, escritura solo de administradores
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Retira tambien las policies legacy que permitian subir como anon.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND (
              policyname ILIKE '%product%image%'
              OR coalesce(qual, '') ILIKE '%product-images%'
              OR coalesce(with_check, '') ILIKE '%product-images%'
          )
    LOOP
        EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
    END LOOP;
END $$;

CREATE POLICY product_images_public_read
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'product-images');
CREATE POLICY product_images_admin_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND public.es_admin()
    AND (storage.foldername(name))[1] = 'products'
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'avif')
);
CREATE POLICY product_images_admin_update
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND public.es_admin())
WITH CHECK (
    bucket_id = 'product-images'
    AND public.es_admin()
    AND (storage.foldername(name))[1] = 'products'
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'avif')
);
CREATE POLICY product_images_admin_delete
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND public.es_admin());

REVOKE INSERT, UPDATE, DELETE ON storage.objects FROM anon;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime para que la tienda se actualice sin recargar
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication
        WHERE pubname = 'supabase_realtime' AND puballtables = false
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'productos'
        ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.productos; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'insumos'
        ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.insumos; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'categorias_productos'
        ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.categorias_productos; END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'extras_inventario'
        ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.extras_inventario; END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.pedidos
        WHERE estado_pago IN ('pendiente', 'pendiente_efectivo', 'pendiente_transferencia')
          AND stock_descontado = true
          AND NOT EXISTS (
              SELECT 1 FROM public.movimientos_stock_pedido m
              WHERE m.pedido_id = pedidos.id AND m.restaurado_at IS NULL
          )
    ) THEN
        RAISE WARNING 'Hay pedidos pendientes legacy marcados como descontados sin ledger. Revisarlos manualmente.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.pedidos
        WHERE estado_pago IN ('aprobado', 'preparacion', 'entregado')
          AND stock_descontado = false
    ) THEN
        RAISE WARNING 'Hay pedidos confirmados sin stock descontado. Revisarlos manualmente.';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- PASO MANUAL DESPUES DE ESTA MIGRACION
-- 1) En Supabase > Authentication > Users, crear el usuario administrador.
-- 2) Reemplazar el email y ejecutar esta sentencia por separado:
--
-- INSERT INTO public.admin_usuarios (user_id, email, activo)
-- SELECT id, email, true
-- FROM auth.users
-- WHERE lower(email) = lower('TU_EMAIL_ADMIN@EJEMPLO.COM')
-- ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, activo = true;
-- ============================================================================
