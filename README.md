# Client Manager

Self-hosted IT service management platform aligned with ISO/IEC 20000. Manage clients, projects, services, licenses, support hours, roadmaps, and deliver a read-only client portal with full transparency.

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Postgres + Auth + RLS + Edge Functions)
- Nginx + Docker, designed to sit behind Nginx Proxy Manager

## Features

### Admin Panel

- **Dashboard** — Overview of all clients, services, billing, and upcoming renewals
- **Client Management** — Create, edit, and organize clients with contact details, logos, and alternate emails
- **Projects** — Group services under projects per client
- **Services** — Full service catalog with billing, VPS details (provider, IP, OS, specs), SLA levels, includes/excludes, client responsibilities, operational status, and Uptime Kuma integration
- **Support Hours** — Log time per client/service, track against confirmed monthly hours from each service, progress bars showing usage vs. allocation
- **Licenses** — Track software licenses and subscriptions linked to services, with expiry reminders
- **Payments** — Payment tracking with billing cycle management and revenue overview
- **Roadmap** — Public/private roadmap items with categories, scheduling, and client notifications
- **Data Export/Import** — CSV export and import of services
- **Settings** — Company branding (logo, name), telemetry dashboard
- **Share Tokens** — Generate unique portal URLs per client

### Client Portal (Share Page)

Read-only portal accessible via share token:

1. **What's Coming** — Roadmap with upcoming updates, calendar integration
2. **Service Catalog** — ISO 20000 service sheets with SLA, specs, resource usage, backups, cost breakdown
3. **Licenses** — Active licenses and subscriptions with expiry status
4. **Change Log** — Transparent history of service changes
5. **Support Hours** — Monthly usage tracker with per-service allocation breakdown, progress gauge, and activity log
6. **Contact Manager** — Support request form via email

### Notifications (Edge Functions)

- **notify-client** — Email notifications for roadmap/service actions via Resend, with tracking pixel for read receipts
- **license-reminder** — Automated license expiry reminders via cron
- **track-open** — Email open tracking endpoint

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

### Edge Function Secrets (deployed via Supabase)

- `RESEND_API_KEY` — Resend email service API key
- `RESEND_FROM_EMAIL` — Sender email address
- `RESEND_REPLY_TO` — Reply-to address for notifications

## Data model

- `clients` — Customer accounts with contact info, logo, alternate email
- `projects` — One client can have many projects
- `services` — Attached to a client, optionally to a project; holds billing, VPS specs, SLA, includes/excludes, confirmed support hours, operational status, Uptime Kuma badge URLs, resource usage, cost breakdown
- `service_changes` — Audit trail of changes, visible in the client portal
- `client_share_tokens` — Tokens granting anonymous read access to a per-client portal
- `client_licenses` — Software licenses/subscriptions linked to services
- `support_hours` — Time entries logged per client/service
- `roadmap_items` — Feature/update roadmap with public visibility flag
- `user_settings` — Admin company branding and configuration
- `service_heartbeats` — Service health heartbeat tracking
- `email_opens` — Notification read receipt tracking

All tables have Row Level Security; only the owning user can write, the anon role can read only through a valid share token.

## Support Hours & Confirmed Hours

Each service has a `confirmed_hours_monthly` field representing the contracted support hours included with that service. These hours:

- Are set per service in the admin panel (Billing section)
- Are summed per client to show the total monthly budget
- Drive the progress gauge in both the admin Support Hours view and the client portal
- Appear in the client portal as a per-service allocation breakdown

## License

MIT
