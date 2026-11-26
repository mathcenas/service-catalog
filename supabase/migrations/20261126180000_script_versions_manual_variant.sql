-- sync-script-versions guarda la versión de cada archivo del repo con variant "<plataforma>-manual"
-- cuando el actualizador no lo maneja. El check viejo solo aceptaba windows/windowsServer/linux y
-- hacía fallar toda la sincronización (la vista "Actualizaciones" quedaba sin versiones de GitHub).
ALTER TABLE public.script_versions DROP CONSTRAINT IF EXISTS script_versions_variant_check;
ALTER TABLE public.script_versions ADD CONSTRAINT script_versions_variant_check
  CHECK (variant = ANY (ARRAY['windows', 'windowsServer', 'linux', 'windows-manual', 'linux-manual']));
