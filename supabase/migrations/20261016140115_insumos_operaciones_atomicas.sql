-- Operaciones atómicas con los permisos del llamador (sin elevar privilegios).
CREATE OR REPLACE FUNCTION public.ajustar_stock_insumo_seguro(p_id uuid, p_antes integer, p_despues integer, p_tipo text, p_motivo text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v public.insumos%ROWTYPE; m public.movimientos_inventario%ROWTYPE;
BEGIN
 IF p_despues IS NULL OR p_despues < 0 OR p_tipo NOT IN ('entrada','salida','ajuste') THEN RAISE EXCEPTION 'Ajuste inválido'; END IF;
 SELECT * INTO v FROM public.insumos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Insumo no encontrado'; END IF;
 IF v.stock_actual IS DISTINCT FROM p_antes THEN RAISE EXCEPTION 'El stock cambió en otro dispositivo. Actualiza antes de ajustar.'; END IF;
 IF p_despues = p_antes THEN RETURN jsonb_build_object('insumo',to_jsonb(v),'movimiento',null); END IF;
 UPDATE public.insumos SET stock_actual=p_despues WHERE id=p_id RETURNING * INTO v;
 INSERT INTO public.movimientos_inventario(insumo_id,tipo,cantidad,motivo,stock_antes,stock_despues,creado_por)
 VALUES(p_id,p_tipo,abs(p_despues-p_antes),p_motivo,p_antes,p_despues,p_actor) RETURNING * INTO m;
 RETURN jsonb_build_object('insumo',to_jsonb(v),'movimiento',to_jsonb(m));
END $$;

CREATE OR REPLACE FUNCTION public.eliminar_solicitud_insumo_segura(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE s public.solicitudes_insumos%ROWTYPE; v public.insumos%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public.solicitudes_insumos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('eliminada',true,'insumo',null); END IF;
 IF s.estado='aprobada' THEN
   UPDATE public.insumos SET stock_actual=stock_actual+s.cantidad WHERE id=s.insumo_id RETURNING * INTO v;
   IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo restituir el stock'; END IF;
 END IF;
 DELETE FROM public.movimientos_inventario WHERE referencia_id=p_id;
 DELETE FROM public.solicitudes_insumos WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo eliminar la solicitud'; END IF;
 RETURN jsonb_build_object('eliminada',true,'insumo',CASE WHEN v.id IS NULL THEN null ELSE to_jsonb(v) END);
END $$;
REVOKE ALL ON FUNCTION public.ajustar_stock_insumo_seguro(uuid,integer,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eliminar_solicitud_insumo_segura(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_insumo_seguro(uuid,integer,integer,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_solicitud_insumo_segura(uuid) TO anon, authenticated;
