-- ============================================================================
-- RIOH.ADMIN - Reinicio de datos de prueba antes de la apertura
-- Fecha prevista: 2026-08-12
--
-- EJECUTAR UNA SOLA VEZ desde Supabase > SQL Editor.
--
-- Este script:
--   1. Crea un respaldo privado y recuperable de pedidos y datos relacionados.
--   2. Elimina todos los pedidos y movimientos asociados.
--   3. Reinicia las estadisticas de clientes y los usos de beneficios.
--   4. Reinicia la numeracion de pedidos si usa una secuencia PostgreSQL.
--
-- Este script NO modifica productos, hamburguesas, categorias, recetas, precios,
-- imagenes, configuracion, insumos ni cantidades de stock.
-- ============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.pedidos') IS NULL
       OR to_regclass('public.clientes') IS NULL
       OR to_regclass('public.productos') IS NULL THEN
        RAISE EXCEPTION 'Faltan tablas obligatorias. No se realizo ningun cambio.';
    END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS rioh_backups;
REVOKE ALL ON SCHEMA rioh_backups FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    IF to_regclass('rioh_backups.pedidos_pre_apertura_20260812') IS NOT NULL THEN
        RAISE EXCEPTION
            'El respaldo pre-apertura ya existe. El reinicio no se ejecuto nuevamente.';
    END IF;
END $$;

CREATE TABLE rioh_backups.pedidos_pre_apertura_20260812
AS TABLE public.pedidos;

CREATE TABLE rioh_backups.clientes_pre_apertura_20260812
AS TABLE public.clientes;

DO $$
BEGIN
    IF to_regclass('public.movimientos_stock_pedido') IS NOT NULL THEN
        EXECUTE 'CREATE TABLE rioh_backups.movimientos_pre_apertura_20260812 '
             || 'AS TABLE public.movimientos_stock_pedido';
    END IF;

    IF to_regclass('public.cupones') IS NOT NULL THEN
        EXECUTE 'CREATE TABLE rioh_backups.cupones_pre_apertura_20260812 '
             || 'AS TABLE public.cupones';
    END IF;

    IF to_regclass('public.promociones') IS NOT NULL THEN
        EXECUTE 'CREATE TABLE rioh_backups.promociones_pre_apertura_20260812 '
             || 'AS TABLE public.promociones';
    END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA rioh_backups FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_productos_antes text;
    v_productos_despues text;
    v_secuencia_pedidos text;
BEGIN
    SELECT md5(coalesce(string_agg(row_to_json(p)::text, '' ORDER BY p.id), ''))
    INTO v_productos_antes
    FROM public.productos p;

    -- Los movimientos_stock_pedido se eliminan por ON DELETE CASCADE.
    -- No se llama a funciones de stock: el inventario queda exactamente igual.
    DELETE FROM public.pedidos;

    UPDATE public.clientes
    SET pedidos_count = 0,
        total_gastado = 0,
        ultima_compra = NULL;

    IF to_regclass('public.cupones') IS NOT NULL THEN
        EXECUTE 'UPDATE public.cupones SET usos_actuales = 0';
    END IF;

    IF to_regclass('public.promociones') IS NOT NULL THEN
        EXECUTE 'UPDATE public.promociones SET usos_totales = 0';
    END IF;

    v_secuencia_pedidos := pg_get_serial_sequence('public.pedidos', 'numero_pedido');
    IF v_secuencia_pedidos IS NOT NULL THEN
        PERFORM setval(v_secuencia_pedidos::regclass, 1, false);
    END IF;

    SELECT md5(coalesce(string_agg(row_to_json(p)::text, '' ORDER BY p.id), ''))
    INTO v_productos_despues
    FROM public.productos p;

    IF v_productos_antes IS DISTINCT FROM v_productos_despues THEN
        RAISE EXCEPTION
            'La verificacion de productos fallo. Se revierte toda la operacion.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.pedidos) THEN
        RAISE EXCEPTION
            'Todavia quedan pedidos. Se revierte toda la operacion.';
    END IF;
END $$;

COMMIT;

-- Resultado esperado: todos los valores deben ser 0.
SELECT
    (SELECT count(*) FROM public.pedidos) AS pedidos,
    (SELECT count(*) FROM public.clientes
      WHERE coalesce(pedidos_count, 0) <> 0
         OR coalesce(total_gastado, 0) <> 0
         OR ultima_compra IS NOT NULL) AS clientes_con_metricas,
    CASE
        WHEN to_regclass('public.movimientos_stock_pedido') IS NULL THEN 0
        ELSE (SELECT count(*) FROM public.movimientos_stock_pedido)
    END AS movimientos_stock;
