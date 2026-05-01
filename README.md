# Client Manager

A modern, self-hosted client management system for service providers to track clients, services, billing, and more.

## Features

- **Client Management**: Store and organize client information including contact details, company info, and status
- **Service Tracking**: Track multiple services per client with specifications, pricing, and renewal dates
- **Billing & Finance**: Multi-currency support with various billing cycles and revenue analytics
- **Dashboard Analytics**: Overview of all clients, services, revenue, and expiring services
- **Secure Authentication**: Built with Supabase authentication and Row Level Security
- **Self-Hosted**: Full Docker support for easy deployment

## Tech Stack

- React + TypeScript
- Tailwind CSS
- Supabase (Database + Auth)
- Docker + Docker Compose

## Quick Start

### Using Docker (Recommended)

1. Clone the repository
2. Update the `.env` file with your Supabase credentials
3. Build and run with Docker:

```bash
docker-compose up -d
```

The application will be available at `http://localhost:8080`

### Development

1. Install dependencies:

```bash
npm install
```

2. Update the `.env` file with your Supabase credentials

3. Start the development server:

```bash
npm run dev
```

## Environment Variables

Create a `.env` file with the following variables:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Docker Configuration

The application includes:
- `Dockerfile`: Multi-stage build with nginx for production
- `docker-compose.yml`: Easy orchestration
- `nginx.conf`: Optimized nginx configuration with caching and compression

## Building for Production

```bash
npm run build
```

Or with Docker:

```bash
docker build -t client-manager .
docker run -p 8080:80 client-manager
```

## Database Schema

The application uses Supabase with the following main tables:
- `clients`: Client information and contact details
- `services`: Services provided to clients with specifications
- `service_types`: Predefined service categories (VPS, Domains, etc.)

All tables include Row Level Security policies to ensure data privacy.

## License

MIT
