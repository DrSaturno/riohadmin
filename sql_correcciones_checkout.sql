-- Correcciones de checkout solicitadas por el cliente.
-- Ejecutar una vez en Supabase SQL Editor antes de publicar el frontend.

BEGIN;

-- El checkout permite invitados sin email.
ALTER TABLE public.clientes
    ALTER COLUMN email DROP NOT NULL;

-- El timbre se guarda en el perfil para autocompletar compras futuras.
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS timbre text;

-- Cada pedido conserva una copia de los datos de entrega usados al comprar.
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS timbre text,
    ADD COLUMN IF NOT EXISTS nota text,
    ADD COLUMN IF NOT EXISTS entrega_programada timestamptz;

CREATE INDEX IF NOT EXISTS pedidos_entrega_programada_idx
    ON public.pedidos (entrega_programada)
    WHERE entrega_programada IS NOT NULL;

COMMENT ON COLUMN public.clientes.timbre IS
    'Timbre, departamento o indicación breve guardada para autocompletar el checkout.';
COMMENT ON COLUMN public.pedidos.timbre IS
    'Copia del timbre o departamento informado para este pedido.';
COMMENT ON COLUMN public.pedidos.nota IS
    'Aclaraciones de cocina o entrega informadas por el cliente.';
COMMENT ON COLUMN public.pedidos.entrega_programada IS
    'Fecha y hora solicitada para la entrega, almacenada con zona horaria.';

COMMIT;
