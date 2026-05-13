# Deployment

Use this document only after the user has asked for deployment. Read the root [README.md](../README.md) and active surface READMEs first; they record the installed project's active surfaces, deferred surfaces, release targets, and validation scope.

The default production path is DigitalOcean App Platform plus DigitalOcean Managed PostgreSQL. Do not ask the user to choose a cloud provider during first-run setup. Ask for product-facing release details instead:

- which active surfaces should be released now: backend/API, web, landing, mobile, or full-stack;
- production domains/URLs for API, web, landing, and the mobile API endpoint;
- whether uploads, images, media, exports, or downloads need DigitalOcean Spaces in this release;
- whether real-time chat, presence, collaboration, live notifications, or WebSocket-style updates must work across multiple backend instances;
- whether mobile work includes EAS builds only or App Store / Google Play submission;
- whether an external CDN is required for advanced bot, rate-limit, or geographic traffic controls.

Local setup from `README.md` and [LOCAL_DATABASE.md](LOCAL_DATABASE.md) does not require cloud credentials.

If the user explicitly asks for Yandex Cloud, use [YANDEX_CLOUD.md](YANDEX_CLOUD.md) as the provider runbook. The supported Yandex Cloud alternative is Serverless Containers for backend/API, Managed Service for PostgreSQL for production data, Object Storage for files and static websites, and Cloud CDN for public static/media delivery.

## Secrets And Backend Env

Do not store secrets in the repository. Minimum backend production env:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
CORS_ORIGINS=https://web.example.com,https://landing.example.com
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECURE=true
```

`CORS_ORIGINS` must include every browser origin that calls the API with credentials. Native mobile apps do not need CORS, but Expo web previews or browser-based mobile previews do.

If storage is active, also configure:

```bash
SPACES_REGION=nyc3
SPACES_BUCKET=<project-prod>
SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
SPACES_CDN_BASE_URL=https://images.example.com
SPACES_ACCESS_KEY_ID=<spaces-access-key>
SPACES_SECRET_ACCESS_KEY=<spaces-secret-key>
SPACES_UPLOAD_MAX_BYTES=10485760
SPACES_UPLOAD_URL_TTL_SECONDS=900
SPACES_DOWNLOAD_URL_TTL_SECONDS=300
SPACES_PUBLIC_CACHE_CONTROL="public, max-age=31536000, immutable"
```

## DigitalOcean App Platform

Prerequisites:

1. DigitalOcean account with billing enabled.
2. A project and region chosen close to the expected users.
3. `doctl` installed and authenticated:

```bash
doctl auth init
```

4. A GitHub/GitLab/Bitbucket repository connected to App Platform, or a DigitalOcean Container Registry (DOCR) image source.
5. DigitalOcean Managed PostgreSQL for production. Do not use App Platform dev databases for production data.
6. DigitalOcean Spaces Standard Storage with Spaces CDN when uploads, images, media, exports, or downloads are in scope.
7. DigitalOcean Managed Valkey only when horizontally scaled real-time features need Pub/Sub between backend instances.
8. Production domains and DNS access when custom domains are in scope.

Prefer an App Platform app spec so the backend service, static sites, env, domains, and database attachment stay reviewable. Create or update with:

```bash
doctl apps create --spec <path-to-spec.yaml>
doctl apps update <app-id> --spec <path-to-spec.yaml>
```

Consult the current App Spec docs before applying a generated spec because provider fields and limits can change.

## Backend API

The backend runs as an App Platform web service. Keep the Docker build context at the repository root because [../backend/Dockerfile](../backend/Dockerfile) copies workspace manifests and `packages/contracts`.

Supported build paths:

- Repository build: App Platform service uses `dockerfile_path: backend/Dockerfile` with repository-root build context.
- Container image: build and push to DOCR, then point the App Platform service at that image.

DOCR image workflow:

```bash
docker build -f backend/Dockerfile -t registry.digitalocean.com/<registry>/<project>-backend:latest .
doctl registry login
docker push registry.digitalocean.com/<registry>/<project>-backend:latest
```

Backend service requirements:

- Set the service HTTP port to `3000` or set `PORT` to the App Platform `http_port`.
- Configure health checks to hit `/health`.
- Set `COOKIE_SECURE=true` for HTTPS production traffic.
- Set `CORS_ORIGINS` to the deployed browser origins.
- Attach DigitalOcean Managed PostgreSQL or provide its connection string as `DATABASE_URL`.
- Add Spaces env only when the product uses storage. Leave Spaces env blank for projects without uploads.

Apply Prisma migrations from a protected one-off App Platform console/job with the same production env:

```bash
bun run --cwd backend prisma:deploy
```

Do not run `prisma migrate dev` in production and do not hand-write migration SQL.

## Real-Time And Horizontal Scaling

Keep production architecture monolithic by default: one backend service can own HTTP routes, auth, persistence, and any WebSocket endpoints. Do not split chat, notifications, or presence into separate services unless there is a proven operational need.

When the backend runs as a single instance, WebSocket connection state can stay in that process. When App Platform is scaled to multiple containers, clients may connect to different backend instances. Any feature that must deliver the same event across those instances, such as chat messages, presence changes, or live notifications, needs a shared Pub/Sub broker.

Use DigitalOcean Managed Valkey as the default Redis-compatible broker for cross-instance fanout. Each backend instance publishes domain events to Valkey and subscribes to the channels it needs to deliver events to its local WebSocket connections. Do not add Valkey for ordinary request/response APIs, static pages, or single-instance development.

## Web Static Site

Deploy `web` as an App Platform Static Site component.

Required component shape:

- Source directory/build context: repository root.
- Build command: `bun run build:web`.
- Output directory: `web/dist`.
- Build-time env: `VITE_API_URL=https://api.example.com`.
- Index document: `index.html`.
- Catch-all document: `index.html`, because the React app uses client-side routing.

App Platform Static Sites are served through DigitalOcean's global CDN by default. Do not disable the CDN cache unless the product needs a specific behavior that the built-in CDN cannot provide.

## Landing Static Site

Deploy `landing` as an App Platform Static Site component.

Required component shape:

- Source directory/build context: repository root.
- Build command: `bun run build:landing`.
- Output directory: `landing/dist`.
- Index document: `index.html`.
- Build-time env only when the landing page intentionally needs public config.

Keep landing independent from authenticated browser-app flows unless the product explicitly needs shared API data.

## Managed PostgreSQL

Use DigitalOcean Managed PostgreSQL for production data. When attaching the database inside App Platform, prefer bindable variables such as the database component's `DATABASE_URL`/`DATABASE_PRIVATE_URL` rather than copying raw credentials into the spec.

Operational defaults:

- Keep the database in the same region/VPC as the backend service when possible.
- Enable trusted sources for the App Platform app when using managed database network restrictions.
- Use a connection pool if the app starts hitting connection limits.
- Take backups before destructive schema or data operations.

## Spaces Storage

Use DigitalOcean Spaces Standard Storage plus Spaces CDN for persistent files and media. Do not write uploads to the App Platform container filesystem; it is not durable across deployments or container replacements.

Default production setup:

- Create a Standard Storage Space in the same region group as the backend when practical.
- Enable Spaces CDN for public media and use a custom subdomain such as `images.example.com` when the project has a production domain.
- Configure Spaces CORS for browser direct uploads from deployed web origins.
- Use backend-issued presigned PUT URLs for direct uploads.
- Use public CDN URLs for public immutable media.
- Use short-lived presigned GET URLs for private files.
- Generate optimized image variants in the backend, a worker, or a dedicated App Platform service when the product needs thumbnails, responsive sizes, compression, or format conversion.

DigitalOcean Spaces and Spaces CDN do not provide first-party dynamic image transformation. Add third-party image services only when the user explicitly chooses that product tradeoff.

## CDN And Domains

For `web` and `landing`, App Platform Static Sites already use DigitalOcean's global CDN. This is the default path.

Use an external CDN only for explicit advanced needs such as custom WAF rules, bot filtering, custom rate limiting, or geographic traffic controls. If an external CDN is used in front of App Platform:

- configure the custom domain on the CDN, not in App Platform;
- point the CDN origin to the default App Platform ingress, for example `<app-name>.ondigitalocean.app`;
- use HTTPS on port `443`;
- do not forward the original custom-domain `Host` header to App Platform.

## Expo / EAS

Mobile deployment is separate from DigitalOcean hosting. Use the deployed API URL as the mobile public API endpoint:

```bash
bunx eas-cli env:create --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production
```

Development build:

```bash
bunx eas-cli build --profile development --platform android
bunx eas-cli build --profile development --platform ios
```

Production build:

```bash
bunx eas-cli build --profile production --platform all
```

Apple App Store release work requires Apple Developer Program access. Google Play release work requires a Google Play Developer account.

## Validation

Before changing cloud resources, run the smallest relevant local checks for the active surfaces:

```bash
bun run typecheck
bun run test
bun run build
```

For narrow deployment-only documentation or App Platform config work, run the subset that matches the affected surfaces, for example `bun run build:web`, `bun run build:landing`, or `bun run --cwd backend smoke:docker`.

After deployment:

- verify `/health` on the backend public URL;
- verify browser auth only from allowed `CORS_ORIGINS`;
- verify `web` route refreshes hit the React catch-all instead of a static 404;
- verify `landing` loads static assets from the deployed domain;
- verify public media loads through the Spaces CDN domain when storage is active;
- verify private file links expire and require backend authorization when private storage is active;
- verify Prisma migrations were applied exactly once to the production database.

## Current Upstream Documentation

For deployment questions, consult current upstream docs first. This document captures the repository's deployment shape; provider docs are authoritative for CLI flags, product limits, pricing, and service behavior.

- DigitalOcean App Platform: https://docs.digitalocean.com/products/app-platform/
- Create apps on App Platform: https://docs.digitalocean.com/products/app-platform/how-to/create-apps/
- DigitalOcean App specs: https://docs.digitalocean.com/products/app-platform/reference/app-spec/
- DigitalOcean Static Sites: https://docs.digitalocean.com/products/app-platform/how-to/manage-static-sites/
- DigitalOcean Managed Databases in App Platform: https://docs.digitalocean.com/products/app-platform/how-to/manage-databases/
- DigitalOcean Valkey: https://docs.digitalocean.com/products/databases/valkey/
- DigitalOcean Dockerfile builds: https://docs.digitalocean.com/products/app-platform/reference/dockerfile/
- DigitalOcean Bun buildpack: https://docs.digitalocean.com/products/app-platform/reference/buildpacks/bun/
- DigitalOcean doctl CLI: https://docs.digitalocean.com/reference/doctl/
- DigitalOcean Container Registry: https://docs.digitalocean.com/products/container-registry/
- DigitalOcean Spaces: https://docs.digitalocean.com/products/spaces/
- DigitalOcean Spaces CDN: https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/
- DigitalOcean Spaces S3 compatibility: https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/
- Configure CORS on Spaces: https://docs.digitalocean.com/products/spaces/how-to/configure-cors/
- External CDN in front of App Platform: https://docs.digitalocean.com/products/app-platform/how-to/configure-external-cdn/
- Yandex Cloud alternative runbook: https://yandex.cloud/en/docs/
- Docker Compose: https://docs.docker.com/compose/
- Prisma migrations: https://www.prisma.io/docs/orm/prisma-migrate
- Expo EAS: https://docs.expo.dev/eas/
- EAS Build: https://docs.expo.dev/build/introduction/
