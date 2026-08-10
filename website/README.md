# Public Website

`website` is the public, indexable Anomaly Detector surface. It currently owns
the static Russian landing page and its search/social metadata. It does not own
player authentication, rooms, Tender flows, profiles, history, or the operator
interface; those remain in `webapp` and `adminapp`.

## Stack And Rendering

- Astro and TypeScript;
- static generation by default;
- build output in `website/dist`;
- `PUBLIC_WEBSITE_URL` as the canonical production origin.

Every current page must remain fully usable in generated HTML. Title,
description, canonical URL, Open Graph metadata, and public product copy must not
depend on client JavaScript.

Do not add SSR, server islands, authenticated fragments, or shared API data until
a concrete public-site scenario requires request-specific rendering. Such a
change needs a reviewed privacy and caching contract, an Astro adapter, a runtime
deployment target, and updates to the architecture and deployment runbooks.

Only anonymous, public-equivalent HTML may use shared CDN caching. Personalized
or auth-dependent responses must use `private` or `no-store` unless a deliberate
and tested `Vary` strategy proves shared caching safe.

## Commands

From the repository root:

```bash
bun run dev:website
bun run typecheck:website
bun run build:website
```

From this workspace:

```bash
bun run dev
bun run typecheck
bun run build
bun run preview
```

Pages live in `src/pages`; static assets live in `public`.

## Deployment

The current production path builds the static site with its concrete canonical
origin and publishes `website/dist` through the Yandex Cloud static-site path:

```bash
PUBLIC_WEBSITE_URL=https://anomaly-detector.ru bun run build:website
```

Follow [the release entrypoint](../docs/DEPLOYMENT.md), the
[release checklist](../docs/RELEASE_CHECKLIST.md), and the provider-specific
[Yandex Cloud runbook](../docs/YANDEX_CLOUD.md). Never publish `adminapp/dist`
inside the public website bucket.

## Validation

Before completion:

- run `bun run typecheck:website` and `bun run build:website`;
- inspect generated canonical and social metadata with `PUBLIC_WEBSITE_URL` set;
- verify the rendered desktop and mobile page has no console or asset errors;
- confirm public output contains no secrets, test URLs, or private player data.

## Current Upstream Documentation

- [Astro documentation](https://docs.astro.build/)
- [Astro pages and routing](https://docs.astro.build/en/basics/astro-pages/)
- [Astro deployment guides](https://docs.astro.build/en/guides/deploy/)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)
