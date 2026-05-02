# Client Manager

Self-hosted IT service catalog aligned with ISO/IEC 20000: clients, projects, services, change history, and a read-only client portal with Uptime Kuma badges.

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Postgres + Auth + RLS)
- Nginx + Docker, designed to sit behind Nginx Proxy Manager

## Quick Start (Docker + Nginx Proxy Manager)

1. Copy the env template and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   # edit .env -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
   ```

2. Make sure Nginx Proxy Manager and this app share a Docker network:
   ```bash
   docker network create npm_proxy   # if not already created
   # attach your NPM container to npm_proxy as well
   ```

3. Build and run:
   ```bash
   docker compose up -d --build
   ```

4. In Nginx Proxy Manager, add a new Proxy Host:
   - Domain: your hostname (e.g., `clients.example.com`)
   - Scheme: `http`
   - Forward Hostname/IP: `client-manager`
   - Forward Port: `80`
   - Enable Websockets Support: on
   - SSL: request a Let's Encrypt certificate as usual

The container exposes `/healthz` which NPM and Docker use for health checks.

## Local development

```bash
npm install
npm run dev
```

## Environment variables

`.env` is read by Vite at build time and baked into the static bundle:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
APP_PORT=8080           # optional, host port mapping
NPM_NETWORK=npm_proxy   # name of the external docker network NPM uses
```

Rebuild the image after changing these values (`docker compose up -d --build`).

## Admin / owner

`mathias@cenas.uy` is registered as the owner/admin account. Default password: `ChangeMe123!` — change it immediately after the first login.

## Data model

- `clients` — customer accounts
- `projects` — one client can have many projects
- `services` — attached to a client, optionally to a project; holds both technical and business/ISO 20000 fields (SLA, includes/excludes, client responsibilities, operational status, Uptime Kuma badge URLs)
- `service_changes` — audit trail of changes, visible in the client portal
- `client_share_tokens` — tokens that grant anonymous read access to a per-client portal

All tables have Row Level Security; only the owning user can write, the anon role can read only through a valid share token.

## Client portal

Admins create a share token per client; the generated URL opens a read-only portal with four sections:

1. Availability — semaphore status per service, with live Uptime Kuma badges
2. Service Catalog — ISO 20000 "service sheet" with SLA, includes / not included / responsibilities
3. Change Log — transparent history of changes applied to services
4. Request Support — form that opens the user's email client with full context

## License

MIT
