-- Posición manual de cada nodo del mapa (arrastrado por el admin). null = acomodo automático.
alter table public.service_map_nodes add column if not exists x real, add column if not exists y real;
