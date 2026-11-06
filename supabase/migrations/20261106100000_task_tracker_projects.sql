-- Tabla de referencia: proyectos de TaskTracker por cliente.
-- tt_client_id = clients.task_tracker_id del portal
-- tt_project_id = project.id en TaskTracker (UUID generado client-side)
-- Se actualiza manualmente cuando se crea/cierra un proyecto en TaskTracker.

CREATE TABLE IF NOT EXISTS task_tracker_projects (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tt_client_id   uuid    NOT NULL,
  tt_project_id  uuid    NOT NULL,
  client_name    text    NOT NULL,
  project_name   text    NOT NULL,
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tt_client_id, tt_project_id)
);

ALTER TABLE task_tracker_projects ENABLE ROW LEVEL SECURITY;

-- Solo el rol autenticado (operador) puede leer/modificar
CREATE POLICY "Authenticated users manage task tracker projects"
  ON task_tracker_projects FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Service role puede leer (edge functions)
CREATE POLICY "Service role read task tracker projects"
  ON task_tracker_projects FOR SELECT
  TO service_role
  USING (true);

-- Seed: proyectos conocidos al momento de la migración
INSERT INTO task_tracker_projects (tt_client_id, tt_project_id, client_name, project_name, is_default) VALUES
  ('9550a9ac-e52d-4321-a006-d0adc5198603', 'b5fbb93a-6f61-45b6-944f-21683e9d9aa2', 'BatistaViajes', 'Gestión de Servicios IT', true),
  ('9550a9ac-e52d-4321-a006-d0adc5198603', 'faf73a95-38e8-4720-9c4f-52822e8d518e', 'BatistaViajes', 'Nuevo Servicio Facturacion', false),

  ('47cbc8e7-ef23-48a4-a96f-b2f8a153f11b', '4435852d-dd30-4eab-b875-613eca4245d1', 'Estudio Varela', 'Gestión de Servicios IT', true),

  ('1d134850-2ef3-4bb9-9716-a3913d825c94', 'aaf4a469-d571-4706-abe6-7a086bf5310c', 'GIS 514', 'AgroMatch', false),
  ('1d134850-2ef3-4bb9-9716-a3913d825c94', 'a57e819d-e282-45dd-a237-cae78ac2434f', 'GIS 514', 'FTP Arroz', false),
  ('1d134850-2ef3-4bb9-9716-a3913d825c94', 'ee05cf59-cad7-4188-a4b7-196e21bd7e86', 'GIS 514', 'Gestión de Infraestructura - PGG', true),
  ('1d134850-2ef3-4bb9-9716-a3913d825c94', '41f768ab-a8ae-43e0-a52b-68b221b7b0aa', 'GIS 514', 'INASE', false),
  ('1d134850-2ef3-4bb9-9716-a3913d825c94', 'ee3fa6a4-4667-4857-bb16-ff28749e5b37', 'GIS 514', 'Pronutrition', false),
  ('1d134850-2ef3-4bb9-9716-a3913d825c94', 'b0fbe106-031e-4993-a914-0d64617b590c', 'GIS 514', 'Robusto-AG', false),

  ('df278352-4d13-46f1-8eab-38959843d9de', '343ab301-3351-4ecb-ab6b-0b6cf268c7cd', 'Genomedica', 'Auditoria Infraestructura IT', true),

  ('616a1aac-fe2e-436d-839b-90ba3ec82367', 'd8e010a4-cffe-4048-8dc5-e70a0a8dc3e3', 'Estudio Carral', 'Evaluacion Servicio IA', false),
  ('616a1aac-fe2e-436d-839b-90ba3ec82367', '5fc1e6f9-63df-4e3c-aed2-10a64cfb89d6', 'Estudio Carral', 'Gestion Natalia', false),
  ('616a1aac-fe2e-436d-839b-90ba3ec82367', '405bdab6-803c-4620-8ed6-18ec71af9f0d', 'Estudio Carral', 'Gestión de Servicios IT', true),

  ('d31140f4-dcf3-407b-a91e-d4f88e678fe1', '565c1b9c-350f-4f58-9918-1f01ad75febe', 'Kapsel', 'Gestión de Servicios IT', true),

  ('26820e74-2a00-4e4f-9cd8-899dcc939e9d', '5cedafe5-fbbf-4a13-9c96-baa4bee7aaf7', 'Pronutrition', 'Migración Pagina Web', false),
  ('26820e74-2a00-4e4f-9cd8-899dcc939e9d', 'be60e8ab-a3a3-4751-8f17-7ffdc73a588d', 'Pronutrition', 'Nuevo Setup Correo', false),
  ('26820e74-2a00-4e4f-9cd8-899dcc939e9d', '56f5cebf-9c48-4293-af4a-3d50c1f79ae3', 'Pronutrition', 'Gestión de Servicios IT', true),

  ('973a1813-da69-4438-8822-b70cf7753cd4', '710ef3ce-547f-4556-bf54-dc528afb2ab0', 'Proyecto-Echo', 'Adquisiciones', false),
  ('973a1813-da69-4438-8822-b70cf7753cd4', '6b6648e6-f772-4e37-939d-abbe0d2a9194', 'Proyecto-Echo', 'Consultoria IT', false),
  ('973a1813-da69-4438-8822-b70cf7753cd4', '6f24753f-22e8-4e04-b27c-dde9c6064561', 'Proyecto-Echo', 'CyberSeguridad', false),
  ('973a1813-da69-4438-8822-b70cf7753cd4', 'abca1822-d959-46c5-a36d-d38d58ba523c', 'Proyecto-Echo', 'Cámara gessel', false),
  ('973a1813-da69-4438-8822-b70cf7753cd4', '8679b5a2-895a-46f0-ad1b-4a916e929c47', 'Proyecto-Echo', 'Gestión de Servicios IT', true),
  ('973a1813-da69-4438-8822-b70cf7753cd4', 'a5f2a07e-1fab-4d98-96f5-e236e7c21c03', 'Proyecto-Echo', 'Nuevo dominio de correo', false),
  ('973a1813-da69-4438-8822-b70cf7753cd4', 'f76d35d9-f5d9-470e-a71c-f51ecc12ac03', 'Proyecto-Echo', 'Nuevo setup Correo', false),

  ('24a63e1a-e74a-408b-87d6-cc16658c3f8d', '99ea3c78-ad17-46f0-b2fa-25c5405008d1', 'RIS Seguros', 'Gestión de Servicios IT', true),

  ('185370e3-7a8b-4308-95f6-290b9ac83231', '3cefd827-5129-41a2-af1f-a94f67d849b5', 'RMI Consultores', 'Gestión de Servicios IT', true),
  ('185370e3-7a8b-4308-95f6-290b9ac83231', 'c4fb025f-aa98-4d0f-a5fd-a68737dfaf72', 'RMI Consultores', 'Implantación ContabilidadRMI', false),
  ('185370e3-7a8b-4308-95f6-290b9ac83231', '54af5754-343d-4171-9a66-8beffd0d1030', 'RMI Consultores', 'Implantación GestionRMI', false),
  ('185370e3-7a8b-4308-95f6-290b9ac83231', '22276d45-c121-42eb-bf78-bc41ef3458c2', 'RMI Consultores', 'Implantación Portal RMI', false),
  ('185370e3-7a8b-4308-95f6-290b9ac83231', '0121a06c-e51d-4fc2-bccb-6d9a4c0fe1d8', 'RMI Consultores', 'Nuevo Cloud RMI', false),

  ('afba88f6-b7f1-4a42-9a84-07651471227b', '71b4b6eb-a760-4f06-a940-d39bb1ad323a', 'Randacor', 'Gestión de Infraestructura', true),

  ('7960e32a-6db2-4154-94f5-f494ea4c8b97', '2daa21ba-e25a-45df-a487-2538db269c9d', 'RedBridge', 'Gestión de Infraestructura', true),

  ('255cb0de-71f5-46f6-8781-611702e5abdc', '8c4ca465-e700-4b27-acdf-b4e6fa33cecd', 'RegionalSur', 'Consultoría IT', false),
  ('255cb0de-71f5-46f6-8781-611702e5abdc', 'a9ed76e3-7dd6-4efe-8319-7b6e8cc26853', 'RegionalSur', 'Estudio Contable', false),
  ('255cb0de-71f5-46f6-8781-611702e5abdc', '285bec27-1305-4713-8374-e7c86566e012', 'RegionalSur', 'Gestión de Infraestructura IT', true),

  ('2d6f7782-d53c-464f-8fbf-3523ed6dba0e', '3743cf52-863f-4a9b-9bbf-f7d73ae14bc1', 'Robusto AG', 'Agro-Match', false),
  ('2d6f7782-d53c-464f-8fbf-3523ed6dba0e', '639e3cb8-8b8e-4763-91ff-cb98969eb16d', 'Robusto AG', 'Farai Sistema', false),
  ('2d6f7782-d53c-464f-8fbf-3523ed6dba0e', '4e5d97c2-5db6-468c-8f6a-bccf02375004', 'Robusto AG', 'Server Prod', true),

  ('cffe34db-ea57-479c-8c33-bc5881f9d423', 'ca02833f-7686-447a-83f0-6f8b2adc7e3d', 'Haras Los Vagones', 'ConsultoriaIT', true),
  ('cffe34db-ea57-479c-8c33-bc5881f9d423', 'aa6a1279-4133-467d-b8e6-5086a9f8c0b5', 'Haras Los Vagones', 'Servicio Web Wordpress', false),

  ('4d65f38f-028e-4e64-96bd-45f9b6fcb086', 'ed4b3fa1-44ac-4b0d-8d69-5e0d51952765', 'Cristarzerbi', 'Actualizacion-SRV-Facturacion', false),
  ('4d65f38f-028e-4e64-96bd-45f9b6fcb086', '61261765-ca66-46a3-a6d3-455206201944', 'Cristarzerbi', 'Gestión de Servicios IT', true),

  ('6f797285-0f10-465f-895f-cdfc4306bde2', '3bb10a96-ed2e-44b0-9901-eb9925bb3c7a', 'El Renegau', 'Consultoria y Hosting Web', true)
ON CONFLICT (tt_client_id, tt_project_id) DO NOTHING;
