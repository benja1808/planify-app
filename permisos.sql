-- Script para HABILITAR ACCESO PÚBLICO A CUALQUIERA (Para nuestro prototipo)

-- 1. Apagamos la seguridad RLS (Row Level Security) temporalmente
ALTER TABLE trabajadores DISABLE ROW LEVEL SECURITY;
ALTER TABLE tareas DISABLE ROW LEVEL SECURITY;

-- 2. Creamos políticas públicas por si se vuelve a activar
CREATE POLICY "Acceso publico total para trabajadores" ON trabajadores FOR ALL USING (true);
CREATE POLICY "Acceso publico total para tareas" ON tareas FOR ALL USING (true);
