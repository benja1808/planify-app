-- Evita cambios parciales y stock negativo en el flujo de inventario.
CREATE OR REPLACE FUNCTION public.ajustar_insumo_seguro(
    p_id uuid,
    p_antes integer,
    p_despues integer,
    p_tipo text,
    p_motivo text,
    p_actor text,
    p_nombre text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v public.insumos%ROWTYPE;
    m public.movimientos_inventario%ROWTYPE;
BEGIN
    IF p_despues IS NULL OR p_despues < 0 OR p_tipo NOT IN ('entrada', 'salida', 'ajuste') THEN
        RAISE EXCEPTION 'Ajuste invalido';
    END IF;
    IF p_nombre IS NOT NULL AND btrim(p_nombre) = '' THEN
        RAISE EXCEPTION 'Nombre invalido';
    END IF;

    SELECT * INTO v FROM public.insumos WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insumo no encontrado'; END IF;
    IF v.stock_actual IS DISTINCT FROM p_antes THEN
        RAISE EXCEPTION 'El stock cambio en otro dispositivo. Actualiza antes de ajustar.';
    END IF;

    UPDATE public.insumos
       SET stock_actual = p_despues,
           nombre = COALESCE(NULLIF(btrim(p_nombre), ''), nombre)
     WHERE id = p_id
     RETURNING * INTO v;

    IF p_despues <> p_antes THEN
        INSERT INTO public.movimientos_inventario(
            insumo_id, tipo, cantidad, motivo, stock_antes, stock_despues, creado_por
        ) VALUES (
            p_id, p_tipo, abs(p_despues - p_antes), p_motivo, p_antes, p_despues, p_actor
        ) RETURNING * INTO m;
    END IF;

    RETURN jsonb_build_object(
        'insumo', to_jsonb(v),
        'movimiento', CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END
    );
END $$;

CREATE OR REPLACE FUNCTION public.eliminar_solicitudes_insumo_seguras(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    cantidad_objetivo integer;
    cantidad_eliminada integer;
    insumos_actualizados jsonb;
BEGIN
    IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
        RETURN jsonb_build_object('eliminadas', 0, 'insumos', '[]'::jsonb);
    END IF;

    PERFORM id FROM public.solicitudes_insumos
     WHERE id = ANY(p_ids)
     ORDER BY id
     FOR UPDATE;
    SELECT count(*) INTO cantidad_objetivo
      FROM public.solicitudes_insumos
     WHERE id = ANY(p_ids);

    WITH restituciones AS (
        SELECT insumo_id, sum(cantidad)::integer AS cantidad
          FROM public.solicitudes_insumos
         WHERE id = ANY(p_ids) AND estado = 'aprobada'
         GROUP BY insumo_id
    ), actualizados AS (
        UPDATE public.insumos i
           SET stock_actual = i.stock_actual + r.cantidad
          FROM restituciones r
         WHERE i.id = r.insumo_id
        RETURNING i.*
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(actualizados)), '[]'::jsonb)
      INTO insumos_actualizados
      FROM actualizados;

    DELETE FROM public.movimientos_inventario WHERE referencia_id = ANY(p_ids);
    DELETE FROM public.solicitudes_insumos WHERE id = ANY(p_ids);
    GET DIAGNOSTICS cantidad_eliminada = ROW_COUNT;

    IF cantidad_eliminada <> cantidad_objetivo THEN
        RAISE EXCEPTION 'No se pudieron eliminar todas las solicitudes';
    END IF;

    RETURN jsonb_build_object('eliminadas', cantidad_eliminada, 'insumos', insumos_actualizados);
END $$;

CREATE OR REPLACE FUNCTION public.procesar_aprobacion_solicitud_insumo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF NEW.estado = 'aprobada' AND COALESCE(OLD.estado, 'pendiente') = 'pendiente' THEN
        UPDATE public.insumos
           SET stock_actual = stock_actual - NEW.cantidad
         WHERE id = NEW.insumo_id
           AND stock_actual >= NEW.cantidad;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Stock insuficiente para aprobar la solicitud';
        END IF;

        INSERT INTO public.movimientos_inventario(
            insumo_id, tipo, cantidad, referencia_id, creado_por, fecha
        )
        SELECT NEW.insumo_id, 'salida', NEW.cantidad, NEW.id, NEW.aprobado_por,
               COALESCE(NEW.fecha_aprobacion, timezone('utc'::text, now()))
        WHERE NOT EXISTS (
            SELECT 1 FROM public.movimientos_inventario
             WHERE referencia_id = NEW.id AND tipo = 'salida'
        );
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.ajustar_insumo_seguro(uuid, integer, integer, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_solicitudes_insumo_seguras(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajustar_insumo_seguro(uuid, integer, integer, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_solicitudes_insumo_seguras(uuid[]) TO anon, authenticated;
