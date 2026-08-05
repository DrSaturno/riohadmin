-- ═══════════════════════════════════════════════════════════════
-- SQL DEFINITIVO: Recetas con doble_mult + Porción de Papas
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1) Porción de Papas → agregar receta con Papas Bastón.
-- El insumo está medido en kg: 200 g equivalen a 0.2 kg.
UPDATE productos
SET receta = '{
  "ingredientes": [
    {
      "ingrediente_id": "fa0963b7-6a1c-4756-a93d-23dbc8a332ee",
      "nombre": "Papas Bastón (Crudas)",
      "unidad": "kg",
      "cantidad": 0.2
    }
  ]
}'::jsonb
WHERE id = '309efc41-f023-4323-a038-7751ea4347aa';

-- Verificación: mostrar todas las recetas
SELECT id, nombre, receta
FROM productos
WHERE receta IS NOT NULL
ORDER BY nombre;
