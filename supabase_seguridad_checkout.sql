-- ============================================================================
-- RIOH.ADMIN - Seguridad integral de checkout y datos personales
-- Ejecutar DESPUES de supabase_migracion_productos_integral.sql.
-- Es idempotente y reemplaza las politicas/RPC sensibles del proyecto.
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.es_admin()') IS NULL
       OR to_regprocedure('public._aplicar_movimiento_stock(jsonb,integer,uuid)') IS NULL THEN
        RAISE EXCEPTION
            'Falta la migracion base. Ejecuta primero supabase_migracion_productos_integral.sql.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columnas y limites requeridos por el checkout seguro
-- ---------------------------------------------------------------------------

ALTER TABLE public.extras_inventario
    ADD COLUMN IF NOT EXISTS precio numeric NOT NULL DEFAULT 1500;

ALTER TABLE public.promociones
    ADD COLUMN IF NOT EXISTS solo_registrados boolean NOT NULL DEFAULT false;

UPDATE public.extras_inventario
SET precio = 1500
WHERE precio IS NULL OR precio < 0;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS idempotency_key uuid,
    ADD COLUMN IF NOT EXISTS estadisticas_contabilizadas boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS beneficio_contabilizado boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_idempotency_key_uidx
    ON public.pedidos (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pedidos_user_created_idx
    ON public.pedidos (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS clientes_user_id_idx
    ON public.clientes (user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS clientes_email_lower_idx
    ON public.clientes (lower(email))
    WHERE email IS NOT NULL;

UPDATE public.pedidos
SET estadisticas_contabilizadas = (
        cliente_id IS NOT NULL
        AND coalesce(estado_pago IN ('aprobado', 'preparacion', 'entregado'), false)
    ),
    beneficio_contabilizado = (
        coalesce(estado_pago, 'pendiente') <> 'cancelado'
        AND (cupon_id IS NOT NULL OR promo_id IS NOT NULL)
    );

UPDATE public.cupones c
SET usos_actuales = stats.usos
FROM (
    SELECT c2.id, count(p.id)::integer AS usos
    FROM public.cupones c2
    LEFT JOIN public.pedidos p
     ON p.cupon_id = c2.id
     AND coalesce(p.estado_pago, 'pendiente') <> 'cancelado'
    GROUP BY c2.id
) stats
WHERE c.id = stats.id;

UPDATE public.promociones promo
SET usos_totales = stats.usos
FROM (
    SELECT promo2.id, count(p.id)::integer AS usos
    FROM public.promociones promo2
    LEFT JOIN public.pedidos p
     ON p.promo_id = promo2.id
     AND coalesce(p.estado_pago, 'pendiente') <> 'cancelado'
    GROUP BY promo2.id
) stats
WHERE promo.id = stats.id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.extras_inventario'::regclass
          AND conname = 'extras_inventario_precio_no_negativo'
    ) THEN
        ALTER TABLE public.extras_inventario
            ADD CONSTRAINT extras_inventario_precio_no_negativo
            CHECK (precio >= 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.clientes'::regclass
          AND conname = 'clientes_datos_longitud_segura'
    ) THEN
        ALTER TABLE public.clientes
            ADD CONSTRAINT clientes_datos_longitud_segura CHECK (
                char_length(coalesce(nombre, '')) <= 100
                AND char_length(coalesce(whatsapp, '')) <= 30
                AND char_length(coalesce(email, '')) <= 254
                AND char_length(coalesce(direccion, '')) <= 220
                AND char_length(coalesce(timbre, '')) <= 80
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.pedidos'::regclass
          AND conname = 'pedidos_datos_longitud_segura'
    ) THEN
        ALTER TABLE public.pedidos
            ADD CONSTRAINT pedidos_datos_longitud_segura CHECK (
                char_length(coalesce(direccion_entrega, '')) <= 220
                AND char_length(coalesce(zona, '')) <= 80
                AND char_length(coalesce(timbre, '')) <= 80
                AND char_length(coalesce(nota, '')) <= 500
                AND jsonb_typeof(coalesce(items, '[]'::jsonb)) = 'array'
                AND jsonb_array_length(coalesce(items, '[]'::jsonb)) BETWEEN 1 AND 50
                AND coalesce(subtotal, 0) >= 0
                AND coalesce(monto_descuento, 0) >= 0
                AND coalesce(costo_envio, 0) >= 0
                AND coalesce(total, 0) >= 0
            ) NOT VALID;
    END IF;
END $$;

-- Los pedidos ya confirmados se consideran contabilizados. Luego se recalculan
-- los acumulados de clientes desde la fuente real para eliminar deriva previa.
UPDATE public.pedidos
SET estadisticas_contabilizadas = true
WHERE estado_pago IN ('aprobado', 'preparacion', 'entregado');

UPDATE public.pedidos
SET beneficio_contabilizado = true
WHERE estado_pago <> 'cancelado'
  AND (cupon_id IS NOT NULL OR promo_id IS NOT NULL);

UPDATE public.clientes c
SET pedidos_count = stats.cantidad,
    total_gastado = stats.total,
    ultima_compra = stats.ultima
FROM (
    SELECT
        c2.id,
        count(p.id)::integer AS cantidad,
        coalesce(sum(p.total), 0) AS total,
        max(p.created_at) AS ultima
    FROM public.clientes c2
    LEFT JOIN public.pedidos p
      ON p.cliente_id = c2.id
     AND p.estado_pago IN ('aprobado', 'preparacion', 'entregado')
    GROUP BY c2.id
) stats
WHERE c.id = stats.id;

-- ---------------------------------------------------------------------------
-- 2. Helpers de cotizacion y horarios
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._calcular_beneficio_seguro(
    p_tipo text,
    p_valor numeric,
    p_buy_qty integer,
    p_get_qty integer,
    p_second_unit_percent numeric,
    p_items jsonb,
    p_subtotal numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_item jsonb;
    v_qty integer;
    v_unit_price numeric;
    v_discount numeric := 0;
BEGIN
    CASE lower(coalesce(p_tipo, ''))
        WHEN 'percent' THEN
            v_discount := p_subtotal * greatest(0, least(coalesce(p_valor, 0), 100)) / 100;
        WHEN 'fixed' THEN
            v_discount := greatest(0, coalesce(p_valor, 0));
        WHEN 'multi_buy' THEN
            IF coalesce(p_buy_qty, 0) > 0
               AND coalesce(p_get_qty, -1) >= 0
               AND p_get_qty < p_buy_qty THEN
                FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
                LOOP
                    v_qty := greatest(0, coalesce((v_item->>'qty')::integer, 0));
                    v_unit_price := greatest(0, coalesce((v_item->>'pricePerUnit')::numeric, 0));
                    v_discount := v_discount
                        + floor(v_qty::numeric / p_buy_qty)
                        * (p_buy_qty - p_get_qty)
                        * v_unit_price;
                END LOOP;
            END IF;
        WHEN 'second_unit' THEN
            FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
            LOOP
                v_qty := greatest(0, coalesce((v_item->>'qty')::integer, 0));
                v_unit_price := greatest(0, coalesce((v_item->>'pricePerUnit')::numeric, 0));
                v_discount := v_discount
                    + floor(v_qty::numeric / 2)
                    * v_unit_price
                    * greatest(0, least(coalesce(p_second_unit_percent, 0), 100)) / 100;
            END LOOP;
        ELSE
            v_discount := 0;
    END CASE;

    RETURN least(greatest(round(v_discount, 2), 0), greatest(p_subtotal, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public._tienda_acepta_pedidos()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_manual boolean := false;
    v_hours jsonb;
    v_now timestamp;
    v_dow integer;
    v_minutes integer;
    v_open integer;
    v_close integer;
    v_days integer[];
BEGIN
    SELECT coalesce((valor->>'online')::boolean, false)
    INTO v_manual
    FROM public.configuracion
    WHERE id = 'ventas_web';

    IF coalesce(v_manual, false) THEN
        RETURN true;
    END IF;

    SELECT valor INTO v_hours
    FROM public.configuracion
    WHERE id = 'horarios_atencion';

    IF v_hours IS NULL
       OR jsonb_typeof(v_hours->'dias') <> 'array'
       OR jsonb_array_length(v_hours->'dias') = 0 THEN
        RETURN false;
    END IF;

    v_now := timezone('America/Argentina/Buenos_Aires', now());
    v_dow := extract(dow FROM v_now)::integer;
    v_minutes := extract(hour FROM v_now)::integer * 60 + extract(minute FROM v_now)::integer;
    v_open := extract(hour FROM (coalesce(v_hours->>'hora_apertura', '18:00'))::time)::integer * 60
        + extract(minute FROM (coalesce(v_hours->>'hora_apertura', '18:00'))::time)::integer;
    v_close := extract(hour FROM (coalesce(v_hours->>'hora_cierre', '00:00'))::time)::integer * 60
        + extract(minute FROM (coalesce(v_hours->>'hora_cierre', '00:00'))::time)::integer;
    SELECT array_agg(value::integer) INTO v_days
    FROM jsonb_array_elements_text(v_hours->'dias');

    IF v_close > v_open THEN
        RETURN v_dow = ANY(v_days) AND v_minutes >= v_open AND v_minutes < v_close;
    END IF;

    RETURN (v_dow = ANY(v_days) AND v_minutes >= v_open)
        OR (((v_dow + 6) % 7) = ANY(v_days) AND v_minutes < v_close);
END;
$$;

CREATE OR REPLACE FUNCTION public._horario_entrega_valido(p_entrega timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_hours jsonb;
    v_local timestamp;
    v_dow integer;
    v_minutes integer;
    v_open integer;
    v_close integer;
    v_days integer[];
    v_service_dow integer;
BEGIN
    IF p_entrega IS NULL
       OR p_entrega < now() + interval '25 minutes'
       OR p_entrega > now() + interval '24 hours' THEN
        RETURN false;
    END IF;

    v_local := timezone('America/Argentina/Buenos_Aires', p_entrega);
    IF extract(second FROM v_local) <> 0
       OR extract(minute FROM v_local)::integer % 15 <> 0 THEN
        RETURN false;
    END IF;

    SELECT valor INTO v_hours
    FROM public.configuracion
    WHERE id = 'horarios_atencion';
    IF v_hours IS NULL OR jsonb_typeof(v_hours->'dias') <> 'array' THEN
        RETURN false;
    END IF;

    v_dow := extract(dow FROM v_local)::integer;
    v_minutes := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
    v_open := extract(hour FROM (coalesce(v_hours->>'hora_apertura', '18:00'))::time)::integer * 60
        + extract(minute FROM (coalesce(v_hours->>'hora_apertura', '18:00'))::time)::integer;
    v_close := extract(hour FROM (coalesce(v_hours->>'hora_cierre', '00:00'))::time)::integer * 60
        + extract(minute FROM (coalesce(v_hours->>'hora_cierre', '00:00'))::time)::integer;
    SELECT array_agg(value::integer) INTO v_days
    FROM jsonb_array_elements_text(v_hours->'dias');

    IF v_close > v_open THEN
        RETURN v_dow = ANY(v_days) AND v_minutes BETWEEN v_open AND v_close;
    END IF;

    v_service_dow := CASE WHEN v_minutes <= v_close THEN (v_dow + 6) % 7 ELSE v_dow END;
    RETURN v_service_dow = ANY(v_days)
        AND (v_minutes >= v_open OR v_minutes <= v_close);
END;
$$;

CREATE OR REPLACE FUNCTION public._cotizar_pedido_seguro(
    p_items jsonb,
    p_codigo_cupon text,
    p_metodo_entrega text,
    p_zona text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item jsonb;
    v_product record;
    v_extra jsonb;
    v_extra_row record;
    v_product_id uuid;
    v_qty integer;
    v_extra_qty integer;
    v_type text;
    v_type_label text;
    v_extra_name text;
    v_extras jsonb;
    v_items jsonb := '[]'::jsonb;
    v_unit_price numeric;
    v_line_total numeric;
    v_subtotal numeric := 0;
    v_shipping numeric := 0;
    v_discount numeric := 0;
    v_candidate_discount numeric;
    v_coupon record;
    v_promo record;
    v_coupon_id uuid;
    v_coupon_code text;
    v_promo_id uuid;
    v_zone_key text;
    v_zone_label text;
BEGIN
    IF jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(p_items, '[]'::jsonb)) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'El pedido debe tener entre 1 y 50 items.';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        BEGIN
            v_product_id := (v_item->>'product_id')::uuid;
            IF coalesce(v_item->>'qty', '') !~ '^[1-9][0-9]*$' THEN
                RAISE EXCEPTION 'Cantidad invalida.';
            END IF;
            v_qty := (v_item->>'qty')::integer;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Hay un item invalido en el pedido.';
        END;

        IF v_qty > 20 THEN
            RAISE EXCEPTION 'La cantidad maxima por producto es 20.';
        END IF;

        SELECT
            p.id,
            p.nombre,
            p.precio_simple,
            p.precio_doble,
            p.activo,
            c.tipo_venta,
            c.activo AS categoria_activa
        INTO v_product
        FROM public.productos p
        JOIN public.categorias_productos c ON c.slug = p.categoria
        WHERE p.id = v_product_id;

        IF NOT FOUND OR v_product.activo IS NOT TRUE OR v_product.categoria_activa IS NOT TRUE THEN
            RAISE EXCEPTION 'Uno de los productos ya no esta disponible.';
        END IF;

        v_type := lower(trim(coalesce(v_item->>'type', '')));
        IF v_product.tipo_venta = 'configurable' THEN
            IF v_type NOT IN ('simple', 'doble') THEN
                RAISE EXCEPTION 'Selecciona un tamano valido para %.', v_product.nombre;
            END IF;
            IF v_type = 'doble' AND coalesce(v_product.precio_doble, 0) <= 0 THEN
                RAISE EXCEPTION '% no tiene opcion doble.', v_product.nombre;
            END IF;
            v_unit_price := CASE
                WHEN v_type = 'doble' THEN v_product.precio_doble
                ELSE v_product.precio_simple
            END;
            v_type_label := initcap(v_type);
        ELSE
            IF v_type <> '' THEN
                RAISE EXCEPTION '% no admite tamano simple o doble.', v_product.nombre;
            END IF;
            v_unit_price := v_product.precio_simple;
            v_type_label := '';
        END IF;

        IF coalesce(v_unit_price, 0) < 0 THEN
            RAISE EXCEPTION 'El precio de % no es valido.', v_product.nombre;
        END IF;

        v_extras := '[]'::jsonb;
        IF v_item ? 'extras' AND jsonb_typeof(v_item->'extras') <> 'array' THEN
            RAISE EXCEPTION 'Los extras de % no son validos.', v_product.nombre;
        END IF;
        IF jsonb_array_length(coalesce(v_item->'extras', '[]'::jsonb)) > 10 THEN
            RAISE EXCEPTION 'Hay demasiados extras en un producto.';
        END IF;

        FOR v_extra IN
            SELECT value FROM jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb))
        LOOP
            IF v_product.tipo_venta <> 'configurable' THEN
                RAISE EXCEPTION '% no admite extras.', v_product.nombre;
            END IF;

            v_extra_name := trim(CASE
                WHEN jsonb_typeof(v_extra) = 'string' THEN v_extra #>> '{}'
                ELSE coalesce(v_extra->>'name', '')
            END);
            IF coalesce(CASE WHEN jsonb_typeof(v_extra) = 'object' THEN v_extra->>'qty' ELSE '1' END, '')
                !~ '^[1-9][0-9]*$' THEN
                RAISE EXCEPTION 'Cantidad invalida para un extra.';
            END IF;
            v_extra_qty := CASE
                WHEN jsonb_typeof(v_extra) = 'object' THEN coalesce((v_extra->>'qty')::integer, 1)
                ELSE 1
            END;
            IF v_extra_qty > 2 THEN
                RAISE EXCEPTION 'La cantidad maxima por extra es 2.';
            END IF;

            SELECT nombre_extra, precio
            INTO v_extra_row
            FROM public.extras_inventario
            WHERE activo = true AND lower(nombre_extra) = lower(v_extra_name);
            IF NOT FOUND THEN
                RAISE EXCEPTION 'El extra "%" no esta disponible.', v_extra_name;
            END IF;

            v_unit_price := v_unit_price + v_extra_row.precio * v_extra_qty;
            v_extras := v_extras || jsonb_build_array(jsonb_build_object(
                'name', v_extra_row.nombre_extra,
                'qty', v_extra_qty,
                'unitPrice', v_extra_row.precio
            ));
        END LOOP;

        v_line_total := round(v_unit_price * v_qty, 2);
        v_subtotal := v_subtotal + v_line_total;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'product_id', v_product.id,
            'title', v_product.nombre,
            'type', v_type_label,
            'qty', v_qty,
            'extras', v_extras,
            'pricePerUnit', round(v_unit_price, 2),
            'total', v_line_total
        ));
    END LOOP;

    IF lower(coalesce(p_metodo_entrega, '')) = 'delivery' THEN
        v_zone_key := lower(trim(coalesce(p_zona, '')));
        v_zone_label := CASE v_zone_key
            WHEN 'saavedra' THEN 'SAAVEDRA'
            WHEN 'nunez' THEN 'NUNEZ'
            WHEN 'belgrano' THEN 'BELGRANO'
            WHEN 'villa-urquiza' THEN 'VILLA URQUIZA'
            WHEN 'florida' THEN 'FLORIDA'
            WHEN 'villa-martelli' THEN 'V. MARTELLI'
            WHEN 'vicente-lopez' THEN 'VICENTE LOPEZ'
            ELSE NULL
        END;
        IF v_zone_label IS NULL THEN
            RAISE EXCEPTION 'La zona de entrega no es valida.';
        END IF;
        v_shipping := 0;
    ELSIF lower(coalesce(p_metodo_entrega, '')) = 'pickup' THEN
        v_zone_key := NULL;
        v_zone_label := NULL;
        v_shipping := 0;
    ELSE
        RAISE EXCEPTION 'El metodo de entrega no es valido.';
    END IF;

    v_coupon_code := nullif(upper(trim(coalesce(p_codigo_cupon, ''))), '');
    IF v_coupon_code IS NOT NULL THEN
        SELECT * INTO v_coupon
        FROM public.cupones
        WHERE upper(codigo) = v_coupon_code
          AND activo = true
          AND (limite_usos IS NULL OR coalesce(usos_actuales, 0) < limite_usos);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cupon invalido o agotado.';
        END IF;

        v_discount := public._calcular_beneficio_seguro(
            v_coupon.tipo,
            v_coupon.valor,
            v_coupon.buy_qty,
            v_coupon.get_qty,
            v_coupon.second_unit_percent,
            v_items,
            v_subtotal
        );
        v_coupon_id := v_coupon.id;
    ELSE
        FOR v_promo IN
            SELECT *
            FROM public.promociones
            WHERE activo = true
              AND (coalesce(solo_registrados, false) = false OR auth.uid() IS NOT NULL)
              AND (limite_usos IS NULL OR coalesce(usos_totales, 0) < limite_usos)
            ORDER BY created_at, id
        LOOP
            v_candidate_discount := public._calcular_beneficio_seguro(
                v_promo.tipo,
                v_promo.valor,
                v_promo.buy_qty,
                v_promo.get_qty,
                v_promo.second_unit_percent,
                v_items,
                v_subtotal
            );
            IF v_candidate_discount > v_discount THEN
                v_discount := v_candidate_discount;
                v_promo_id := v_promo.id;
            END IF;
        END LOOP;
    END IF;

    v_subtotal := round(v_subtotal, 2);
    v_discount := least(round(v_discount, 2), v_subtotal);

    RETURN jsonb_build_object(
        'items', v_items,
        'subtotal', v_subtotal,
        'discount', v_discount,
        'shipping', v_shipping,
        'total', round(v_subtotal - v_discount + v_shipping, 2),
        'couponId', v_coupon_id,
        'couponCode', v_coupon_code,
        'promoId', v_promo_id,
        'zoneKey', v_zone_key,
        'zoneLabel', v_zone_label
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cotizar_pedido_seguro(
    p_items jsonb,
    p_codigo_cupon text,
    p_metodo_entrega text,
    p_zona text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_quote jsonb;
    v_stock jsonb;
BEGIN
    v_quote := public._cotizar_pedido_seguro(
        p_items,
        p_codigo_cupon,
        p_metodo_entrega,
        p_zona
    );
    v_stock := public.validar_stock_carrito(v_quote->'items');
    IF coalesce((v_stock->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Uno de los productos no tiene stock suficiente.';
    END IF;
    RETURN v_quote;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_extras_publicos()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'nombre_extra', ei.nombre_extra,
                'precio', ei.precio
            )
            ORDER BY ei.nombre_extra
        ),
        '[]'::jsonb
    )
    FROM public.extras_inventario ei
    WHERE ei.activo = true;
$$;

CREATE OR REPLACE FUNCTION public._capacidad_producto_segura(
    p_receta jsonb,
    p_stock numeric,
    p_es_doble boolean
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ingrediente jsonb;
    v_id uuid;
    v_necesario numeric;
    v_stock numeric;
    v_capacidad integer := 2147483647;
BEGIN
    IF jsonb_typeof(coalesce(p_receta->'ingredientes', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(coalesce(p_receta->'ingredientes', '[]'::jsonb)) = 0 THEN
        RETURN greatest(0, least(coalesce(floor(p_stock), 0), 2147483647))::integer;
    END IF;

    FOR v_ingrediente IN
        SELECT value
        FROM jsonb_array_elements(p_receta->'ingredientes')
    LOOP
        BEGIN
            v_id := (v_ingrediente->>'ingrediente_id')::uuid;
            v_necesario := (v_ingrediente->>'cantidad')::numeric
                * CASE
                    WHEN p_es_doble
                        THEN coalesce(nullif(v_ingrediente->>'doble_mult', '')::numeric, 1)
                    ELSE 1
                  END;
        EXCEPTION WHEN OTHERS THEN
            RETURN 0;
        END;

        IF coalesce(v_necesario, 0) <= 0 THEN
            RETURN 0;
        END IF;
        SELECT stock_actual INTO v_stock FROM public.insumos WHERE id = v_id;
        IF NOT FOUND THEN
            RETURN 0;
        END IF;
        v_capacidad := least(v_capacidad, greatest(0, floor(v_stock / v_necesario))::integer);
    END LOOP;

    RETURN greatest(0, v_capacidad);
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_menu_publico()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'categories', coalesce((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', c.id,
                    'slug', c.slug,
                    'nombre', c.nombre,
                    'descripcion', c.descripcion,
                    'tipo_venta', c.tipo_venta,
                    'orden', c.orden
                ) ORDER BY c.orden, c.nombre
            )
            FROM public.categorias_productos c
            WHERE c.activo = true
        ), '[]'::jsonb),
        'products', coalesce((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', p.id,
                    'nombre', p.nombre,
                    'descripcion', p.descripcion,
                    'precio_simple', p.precio_simple,
                    'precio_doble', p.precio_doble,
                    'categoria', p.categoria,
                    'imagen_url', p.imagen_url,
                    'destacado', p.destacado,
                    'orden', p.orden,
                    'max_simple', least(20, public._capacidad_producto_segura(p.receta, p.stock, false)),
                    'max_doble', CASE
                        WHEN coalesce(p.precio_doble, 0) > 0
                            THEN least(20, public._capacidad_producto_segura(p.receta, p.stock, true))
                        ELSE 0
                    END
                ) ORDER BY p.orden, p.nombre
            )
            FROM public.productos p
            JOIN public.categorias_productos c ON c.slug = p.categoria AND c.activo = true
            WHERE p.activo = true
        ), '[]'::jsonb),
        'extras', coalesce((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'nombre_extra', ei.nombre_extra,
                    'precio', ei.precio,
                    'max_quantity', least(40, greatest(0, floor(i.stock_actual / ei.cantidad))::integer)
                ) ORDER BY ei.nombre_extra
            )
            FROM public.extras_inventario ei
            JOIN public.insumos i ON i.id = ei.ingrediente_id
            WHERE ei.activo = true
        ), '[]'::jsonb)
    );
$$;

-- ---------------------------------------------------------------------------
-- 3. Perfil autenticado sin exponer la tabla completa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sincronizar_cliente_actual(
    p_nombre text,
    p_whatsapp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text := lower(nullif(trim(auth.jwt()->>'email'), ''));
    v_nombre text := nullif(trim(p_nombre), '');
    v_whatsapp text := nullif(trim(p_whatsapp), '');
    v_cliente public.clientes%ROWTYPE;
BEGIN
    IF v_uid IS NULL OR v_email IS NULL THEN
        RAISE EXCEPTION 'Se requiere una sesion autenticada.';
    END IF;
    IF char_length(coalesce(v_nombre, '')) > 100
       OR char_length(coalesce(v_whatsapp, '')) > 30 THEN
        RAISE EXCEPTION 'Los datos del perfil son demasiado largos.';
    END IF;

    SELECT * INTO v_cliente
    FROM public.clientes
    WHERE user_id = v_uid
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        UPDATE public.clientes
        SET user_id = v_uid,
            email = v_email,
            nombre = coalesce(v_nombre, nombre),
            whatsapp = coalesce(v_whatsapp, whatsapp)
        WHERE id = v_cliente.id
        RETURNING * INTO v_cliente;
    ELSE
        INSERT INTO public.clientes (
            user_id, nombre, whatsapp, email, pedidos_count, total_gastado
        ) VALUES (
            v_uid,
            coalesce(v_nombre, split_part(v_email, '@', 1)),
            coalesce(v_whatsapp, ''),
            v_email,
            0,
            0
        )
        RETURNING * INTO v_cliente;
    END IF;

    RETURN jsonb_build_object(
        'id', v_cliente.id,
        'user_id', v_cliente.user_id,
        'nombre', v_cliente.nombre,
        'whatsapp', v_cliente.whatsapp,
        'email', v_cliente.email,
        'direccion', v_cliente.direccion,
        'timbre', v_cliente.timbre
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Creacion atomica y autoritativa del pedido
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crear_pedido_seguro(
    p_items jsonb,
    p_nombre text,
    p_whatsapp text,
    p_email text,
    p_metodo_entrega text,
    p_zona text,
    p_direccion text,
    p_timbre text,
    p_nota text,
    p_entrega_programada timestamptz,
    p_metodo_pago text,
    p_codigo_cupon text,
    p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_auth_email text := lower(nullif(trim(auth.jwt()->>'email'), ''));
    v_nombre text := trim(coalesce(p_nombre, ''));
    v_phone text := trim(coalesce(p_whatsapp, ''));
    v_phone_digits text;
    v_email text := lower(nullif(trim(p_email), ''));
    v_address text := trim(coalesce(p_direccion, ''));
    v_doorbell text := nullif(trim(coalesce(p_timbre, '')), '');
    v_note text := nullif(trim(coalesce(p_nota, '')), '');
    v_method text := lower(trim(coalesce(p_metodo_entrega, '')));
    v_payment text := lower(trim(coalesce(p_metodo_pago, '')));
    v_quote jsonb;
    v_stock jsonb;
    v_profile jsonb;
    v_client_id uuid;
    v_order public.pedidos%ROWTYPE;
    v_existing public.pedidos%ROWTYPE;
    v_existing_phone text;
    v_updated uuid;
BEGIN
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Falta el identificador de la operacion.';
    END IF;

    -- Serializa reintentos simultaneos con la misma clave antes de consultar.
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key::text));

    SELECT * INTO v_existing
    FROM public.pedidos
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        IF v_existing.user_id IS NOT NULL THEN
            IF v_uid IS NULL OR v_existing.user_id <> v_uid THEN
                RAISE EXCEPTION 'El identificador de la operacion no es valido.';
            END IF;
        ELSE
            SELECT whatsapp INTO v_existing_phone
            FROM public.clientes
            WHERE id = v_existing.cliente_id;
            IF regexp_replace(coalesce(v_existing_phone, ''), '[^0-9]', '', 'g')
               <> regexp_replace(trim(coalesce(p_whatsapp, '')), '[^0-9]', '', 'g') THEN
                RAISE EXCEPTION 'El identificador de la operacion no es valido.';
            END IF;
        END IF;
        RETURN jsonb_build_object(
            'id', v_existing.id,
            'numeroPedido', v_existing.numero_pedido,
            'createdAt', v_existing.created_at,
            'items', v_existing.items,
            'deliveryMethod', v_existing.metodo_entrega,
            'address', CASE WHEN v_existing.metodo_entrega = 'delivery' THEN v_existing.direccion_entrega ELSE '' END,
            'doorbell', v_existing.timbre,
            'zone', v_existing.zona,
            'deliveryAt', v_existing.entrega_programada,
            'notes', v_existing.nota,
            'subtotal', v_existing.subtotal,
            'discount', v_existing.monto_descuento,
            'shipping', v_existing.costo_envio,
            'total', v_existing.total,
            'paymentMethod', CASE
                WHEN v_existing.estado_pago = 'pendiente_transferencia' THEN 'transferencia'
                ELSE 'efectivo'
            END
        );
    END IF;

    IF public._tienda_acepta_pedidos() IS NOT TRUE THEN
        RAISE EXCEPTION 'El negocio esta cerrado en este momento.';
    END IF;

    v_phone_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    IF char_length(v_nombre) NOT BETWEEN 2 AND 100 THEN
        RAISE EXCEPTION 'El nombre debe tener entre 2 y 100 caracteres.';
    END IF;
    IF char_length(v_phone_digits) NOT BETWEEN 8 AND 15 OR char_length(v_phone) > 30 THEN
        RAISE EXCEPTION 'El telefono no es valido.';
    END IF;
    IF v_email IS NOT NULL AND (
        char_length(v_email) > 254
        OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ) THEN
        RAISE EXCEPTION 'El email no es valido.';
    END IF;
    IF v_uid IS NOT NULL AND v_auth_email IS NOT NULL
       AND v_email IS NOT NULL AND v_email <> v_auth_email THEN
        RAISE EXCEPTION 'El email debe coincidir con la cuenta autenticada.';
    END IF;
    IF char_length(v_address) > 220
       OR char_length(coalesce(v_doorbell, '')) > 80
       OR char_length(coalesce(v_note, '')) > 500 THEN
        RAISE EXCEPTION 'Los datos de entrega son demasiado largos.';
    END IF;
    IF v_payment NOT IN ('efectivo', 'transferencia') THEN
        RAISE EXCEPTION 'El metodo de pago no es valido.';
    END IF;

    IF v_method = 'delivery' THEN
        IF char_length(v_address) < 5 THEN
            RAISE EXCEPTION 'Ingresa una direccion de entrega valida.';
        END IF;
        IF lower(trim(coalesce(p_zona, ''))) IN (
            'saavedra', 'nunez', 'belgrano', 'villa-urquiza', 'florida',
            'villa-martelli', 'vicente-lopez'
        ) AND public._horario_entrega_valido(p_entrega_programada) IS NOT TRUE THEN
            RAISE EXCEPTION 'El horario de entrega ya no esta disponible.';
        END IF;
    ELSIF v_method = 'pickup' THEN
        v_address := 'Retiro en Local';
        p_entrega_programada := NULL;
    ELSE
        RAISE EXCEPTION 'El metodo de entrega no es valido.';
    END IF;

    -- Limite basico por cuenta/telefono. La clave idempotente evita duplicados
    -- causados por reintentos de red.
    IF v_uid IS NOT NULL THEN
        IF (SELECT count(*) FROM public.pedidos
            WHERE user_id = v_uid AND created_at > now() - interval '10 minutes') >= 5 THEN
            RAISE EXCEPTION 'Demasiados pedidos recientes. Espera unos minutos.';
        END IF;
    ELSE
        IF (SELECT count(*)
            FROM public.pedidos p
            JOIN public.clientes c ON c.id = p.cliente_id
            WHERE regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') = v_phone_digits
              AND p.created_at > now() - interval '10 minutes') >= 3 THEN
            RAISE EXCEPTION 'Demasiados pedidos recientes. Espera unos minutos.';
        END IF;
    END IF;

    v_quote := public._cotizar_pedido_seguro(
        p_items,
        p_codigo_cupon,
        v_method,
        p_zona
    );
    v_stock := public.validar_stock_carrito(v_quote->'items');
    IF coalesce((v_stock->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Uno de los productos no tiene stock suficiente.';
    END IF;

    IF v_uid IS NOT NULL THEN
        v_profile := public.sincronizar_cliente_actual(v_nombre, v_phone);
        v_client_id := (v_profile->>'id')::uuid;
        v_email := v_auth_email;
        UPDATE public.clientes
        SET direccion = CASE WHEN v_method = 'delivery' THEN v_address ELSE direccion END,
            timbre = CASE WHEN v_method = 'delivery' THEN v_doorbell ELSE timbre END
        WHERE id = v_client_id;
    ELSE
        INSERT INTO public.clientes (
            user_id, nombre, whatsapp, email, direccion, timbre, pedidos_count, total_gastado
        ) VALUES (
            NULL,
            v_nombre,
            v_phone,
            v_email,
            CASE WHEN v_method = 'delivery' THEN v_address ELSE '' END,
            CASE WHEN v_method = 'delivery' THEN v_doorbell ELSE NULL END,
            0,
            0
        )
        RETURNING id INTO v_client_id;
    END IF;

    IF v_quote->>'couponId' IS NOT NULL THEN
        v_updated := NULL;
        UPDATE public.cupones
        SET usos_actuales = coalesce(usos_actuales, 0) + 1
        WHERE id = (v_quote->>'couponId')::uuid
          AND activo = true
          AND (limite_usos IS NULL OR coalesce(usos_actuales, 0) < limite_usos)
        RETURNING id INTO v_updated;
        IF v_updated IS NULL THEN
            RAISE EXCEPTION 'El cupon acaba de agotarse. Actualiza el pedido.';
        END IF;
    ELSIF v_quote->>'promoId' IS NOT NULL THEN
        v_updated := NULL;
        UPDATE public.promociones
        SET usos_totales = coalesce(usos_totales, 0) + 1
        WHERE id = (v_quote->>'promoId')::uuid
          AND activo = true
          AND (limite_usos IS NULL OR coalesce(usos_totales, 0) < limite_usos)
        RETURNING id INTO v_updated;
        IF v_updated IS NULL THEN
            RAISE EXCEPTION 'La promocion acaba de agotarse. Actualiza el pedido.';
        END IF;
    END IF;

    INSERT INTO public.pedidos (
        cliente_id,
        user_id,
        items,
        metodo_entrega,
        direccion_entrega,
        zona,
        timbre,
        nota,
        entrega_programada,
        subtotal,
        monto_descuento,
        costo_envio,
        total,
        promo_id,
        cupon_id,
        estado_pago,
        idempotency_key,
        beneficio_contabilizado,
        estadisticas_contabilizadas
    ) VALUES (
        v_client_id,
        v_uid,
        v_quote->'items',
        v_method,
        v_address,
        v_quote->>'zoneLabel',
        CASE WHEN v_method = 'delivery' THEN v_doorbell ELSE NULL END,
        v_note,
        CASE WHEN v_method = 'delivery' THEN p_entrega_programada ELSE NULL END,
        (v_quote->>'subtotal')::numeric,
        (v_quote->>'discount')::numeric,
        (v_quote->>'shipping')::numeric,
        (v_quote->>'total')::numeric,
        nullif(v_quote->>'promoId', '')::uuid,
        nullif(v_quote->>'couponId', '')::uuid,
        CASE WHEN v_payment = 'efectivo' THEN 'pendiente_efectivo' ELSE 'pendiente_transferencia' END,
        p_idempotency_key,
        (v_quote->>'couponId' IS NOT NULL OR v_quote->>'promoId' IS NOT NULL),
        false
    )
    RETURNING * INTO v_order;

    RETURN jsonb_build_object(
        'id', v_order.id,
        'numeroPedido', v_order.numero_pedido,
        'createdAt', v_order.created_at,
        'items', v_order.items,
        'deliveryMethod', v_order.metodo_entrega,
        'address', CASE WHEN v_order.metodo_entrega = 'delivery' THEN v_order.direccion_entrega ELSE '' END,
        'doorbell', v_order.timbre,
        'zone', v_order.zona,
        'deliveryAt', v_order.entrega_programada,
        'notes', v_order.nota,
        'subtotal', v_order.subtotal,
        'discount', v_order.monto_descuento,
        'shipping', v_order.costo_envio,
        'total', v_order.total,
        'paymentMethod', v_payment
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Estados de pedido, stock y estadisticas consistentes
-- ---------------------------------------------------------------------------

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
    v_contabilizo boolean := false;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Acceso de administrador requerido.';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;

    v_siguiente := CASE v_pedido.estado_pago
        WHEN 'pendiente' THEN 'aprobado'
        WHEN 'pendiente_efectivo' THEN 'aprobado'
        WHEN 'pendiente_transferencia' THEN 'aprobado'
        WHEN 'aprobado' THEN 'preparacion'
        WHEN 'preparacion' THEN 'entregado'
        ELSE NULL
    END;
    IF v_siguiente IS NULL THEN
        RAISE EXCEPTION 'El pedido no puede avanzar desde %.', v_pedido.estado_pago;
    END IF;

    IF v_pedido.estado_pago IN ('pendiente', 'pendiente_efectivo', 'pendiente_transferencia')
       AND coalesce(v_pedido.stock_descontado, false) = false THEN
        PERFORM public._aplicar_movimiento_stock(v_pedido.items, -1, p_pedido_id);
        v_desconto := true;
    END IF;

    IF v_siguiente = 'aprobado'
       AND coalesce(v_pedido.estadisticas_contabilizadas, false) = false
       AND v_pedido.cliente_id IS NOT NULL THEN
        UPDATE public.clientes
        SET pedidos_count = coalesce(pedidos_count, 0) + 1,
            total_gastado = coalesce(total_gastado, 0) + coalesce(v_pedido.total, 0),
            ultima_compra = now()
        WHERE id = v_pedido.cliente_id;
        v_contabilizo := true;
    END IF;

    UPDATE public.pedidos
    SET estado_pago = v_siguiente,
        stock_descontado = CASE WHEN v_desconto THEN true ELSE stock_descontado END,
        estadisticas_contabilizadas = CASE WHEN v_contabilizo THEN true ELSE estadisticas_contabilizadas END,
        estado_pendiente_original = CASE WHEN v_desconto THEN v_pedido.estado_pago ELSE estado_pendiente_original END
    WHERE id = p_pedido_id;

    RETURN jsonb_build_object(
        'estado_anterior', v_pedido.estado_pago,
        'estado', v_siguiente,
        'stock_descontado_ahora', v_desconto,
        'estadisticas_contabilizadas_ahora', v_contabilizo
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
    v_descontabilizo boolean := false;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Acceso de administrador requerido.';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;

    v_anterior := CASE v_pedido.estado_pago
        WHEN 'aprobado' THEN coalesce(v_pedido.estado_pendiente_original, 'pendiente')
        WHEN 'preparacion' THEN 'aprobado'
        WHEN 'entregado' THEN 'preparacion'
        ELSE NULL
    END;
    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'El pedido no puede retroceder desde %.', v_pedido.estado_pago;
    END IF;

    IF v_pedido.estado_pago = 'aprobado' AND coalesce(v_pedido.stock_descontado, false) THEN
        PERFORM public._restaurar_stock_pedido(p_pedido_id, v_pedido.items);
        v_reintegro := true;
    END IF;

    IF v_pedido.estado_pago = 'aprobado'
       AND coalesce(v_pedido.estadisticas_contabilizadas, false)
       AND v_pedido.cliente_id IS NOT NULL THEN
        UPDATE public.clientes
        SET pedidos_count = greatest(0, coalesce(pedidos_count, 0) - 1),
            total_gastado = greatest(0, coalesce(total_gastado, 0) - coalesce(v_pedido.total, 0))
        WHERE id = v_pedido.cliente_id;
        v_descontabilizo := true;
    END IF;

    UPDATE public.pedidos
    SET estado_pago = v_anterior,
        stock_descontado = CASE WHEN v_reintegro THEN false ELSE stock_descontado END,
        estadisticas_contabilizadas = CASE WHEN v_descontabilizo THEN false ELSE estadisticas_contabilizadas END
    WHERE id = p_pedido_id;

    RETURN jsonb_build_object(
        'estado', v_anterior,
        'stock_reintegrado', v_reintegro,
        'estadisticas_reintegradas', v_descontabilizo
    );
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

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;
    IF v_pedido.estado_pago = 'cancelado' THEN RAISE EXCEPTION 'El pedido ya esta cancelado.'; END IF;

    IF coalesce(v_pedido.stock_descontado, false) THEN
        PERFORM public._restaurar_stock_pedido(p_pedido_id, v_pedido.items);
        v_reintegro := true;
    END IF;

    IF coalesce(v_pedido.estadisticas_contabilizadas, false)
       AND v_pedido.cliente_id IS NOT NULL THEN
        UPDATE public.clientes
        SET pedidos_count = greatest(0, coalesce(pedidos_count, 0) - 1),
            total_gastado = greatest(0, coalesce(total_gastado, 0) - coalesce(v_pedido.total, 0))
        WHERE id = v_pedido.cliente_id;
    END IF;

    IF coalesce(v_pedido.beneficio_contabilizado, false) AND v_pedido.cupon_id IS NOT NULL THEN
        UPDATE public.cupones
        SET usos_actuales = greatest(0, coalesce(usos_actuales, 0) - 1)
        WHERE id = v_pedido.cupon_id;
    ELSIF coalesce(v_pedido.beneficio_contabilizado, false) AND v_pedido.promo_id IS NOT NULL THEN
        UPDATE public.promociones
        SET usos_totales = greatest(0, coalesce(usos_totales, 0) - 1)
        WHERE id = v_pedido.promo_id;
    END IF;

    UPDATE public.pedidos
    SET estado_pago = 'cancelado',
        stock_descontado = false,
        estadisticas_contabilizadas = false,
        beneficio_contabilizado = false,
        cancelado_at = now(),
        cancelado_motivo = left(nullif(trim(p_motivo), ''), 300),
        cancelado_por = auth.uid()
    WHERE id = p_pedido_id;

    RETURN jsonb_build_object('cancelado', true, 'stock_reintegrado', v_reintegro);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS y privilegios: PII privada, administracion solo para admins
-- ---------------------------------------------------------------------------

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promociones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extras_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_productos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'clientes', 'pedidos', 'cupones', 'promociones', 'configuracion',
              'insumos', 'extras_inventario', 'productos', 'categorias_productos'
          )
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
END $$;

CREATE POLICY clientes_admin_total
ON public.clientes FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY clientes_usuario_lectura
ON public.clientes FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY pedidos_admin_total
ON public.pedidos FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY pedidos_usuario_lectura
ON public.pedidos FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY cupones_admin_total
ON public.cupones FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY promociones_admin_total
ON public.promociones FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY configuracion_lectura_publica
ON public.configuracion FOR SELECT TO anon, authenticated
USING (id IN ('ventas_web', 'horarios_atencion'));

CREATE POLICY configuracion_admin_total
ON public.configuracion FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY insumos_admin_total
ON public.insumos FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY extras_inventario_admin_total
ON public.extras_inventario FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY productos_admin_total
ON public.productos FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

CREATE POLICY categorias_productos_admin_total
ON public.categorias_productos FOR ALL TO authenticated
USING (public.es_admin()) WITH CHECK (public.es_admin());

REVOKE ALL ON public.clientes, public.pedidos, public.cupones, public.promociones,
    public.configuracion, public.insumos, public.extras_inventario,
    public.productos, public.categorias_productos
FROM anon, authenticated;

GRANT SELECT ON public.configuracion TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.clientes, public.pedidos, public.cupones, public.promociones, public.configuracion
TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insumos, public.extras_inventario
TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.productos, public.categorias_productos
TO authenticated;

REVOKE ALL ON FUNCTION public._calcular_beneficio_seguro(text, numeric, integer, integer, numeric, jsonb, numeric)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._tienda_acepta_pedidos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._horario_entrega_valido(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cotizar_pedido_seguro(jsonb, text, text, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_stock_carrito(jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cotizar_pedido_seguro(jsonb, text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cotizar_pedido_seguro(jsonb, text, text, text)
TO anon, authenticated;

REVOKE ALL ON FUNCTION public.listar_extras_publicos()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_extras_publicos()
TO anon, authenticated;

REVOKE ALL ON FUNCTION public._capacidad_producto_segura(jsonb, numeric, boolean)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_menu_publico()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_menu_publico()
TO anon, authenticated;

REVOKE ALL ON FUNCTION public.sincronizar_cliente_actual(text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_cliente_actual(text, text)
TO authenticated;

REVOKE ALL ON FUNCTION public.crear_pedido_seguro(
    jsonb, text, text, text, text, text, text, text, text, timestamptz, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_pedido_seguro(
    jsonb, text, text, text, text, text, text, text, text, timestamptz, text, text, uuid
) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.avanzar_pedido_seguro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retroceder_pedido_seguro(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_pedido_seguro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avanzar_pedido_seguro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retroceder_pedido_seguro(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_seguro(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verificacion recomendada despues de ejecutar:
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
