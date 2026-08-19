# Public Website

`website` is the public, indexable Anomaly Detector surface. It currently owns
the static Russian landing page and its search/social metadata. It does not own
player authentication, rooms, Tender flows, profiles, history, or the operator
interface; those remain in `webapp` and `adminapp`.

The approved Production MVP domain boundary assigns
`https://anomaly-detector.ru` to this site and
`https://app.anomaly-detector.ru` to the player app. Until the coordinated DNS,
TLS, CORS, OAuth, cookie and redirect migration is released, deployment docs
must distinguish current routing from this target rather than switching one
surface independently.

## Stack And Rendering

- Astro and TypeScript;
- static generation by default;
- build output in `website/dist`;
- `PUBLIC_WEBSITE_URL` as the canonical production origin.

Every current page must remain fully usable in generated HTML. Title,
description, canonical URL, Open Graph metadata, and public product copy must not
depend on client JavaScript.

The MVP landing includes its real product claim, gameplay explanation, FAQ and
real screenshots in initial HTML. Its machine-readable contract uses verified
facts only: JSON-LD `VideoGame` + `WebApplication`, canonical and social
metadata, `sitemap.xml`, and a tested `robots.txt`. Do not invent ratings,
reviews, player counts or claims for structured data. `llms.txt`, if added, is
only a convenience map and never replaces crawlable HTML or supported search
metadata.

Verified search and AI crawlers may access this public marketing content,
including where their documented policy permits model training. This does not
extend to player, API or operator surfaces. Keep the same useful copy visible
to people and crawlers; do not add hidden bot-only text or doorway pages.

The CTA passes only a bounded continuation intent for the solo tutorial to the
player app. Before analytics consent, the site may record only unrelated
aggregate views. A first-party `journey_id` is created only after a separate
affirmative choice, expires with raw events within 30 days, and must not affect
CTA, registration or play when absent or revoked.

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
- validate JSON-LD, `robots.txt`, `sitemap.xml`, crawlable links and the complete
  initial HTML without JavaScript;
- verify the rendered desktop and mobile page has no console or asset errors;
- verify analytics refusal and storage blocking preserve the CTA/tutorial path;
- confirm public output contains no secrets, test URLs, or private player data.

## Current Upstream Documentation

- [Astro documentation](https://docs.astro.build/)
- [Astro pages and routing](https://docs.astro.build/en/basics/astro-pages/)
- [Astro deployment guides](https://docs.astro.build/en/guides/deploy/)
- [TypeScript documentation](https://www.typescriptlang.org/docs/)
