# Storage And Media

Use this document when Anomaly Detector needs uploads, images, generated files,
exports, or downloadable assets. The current production provider is Yandex
Object Storage with Yandex Cloud CDN for public delivery. Do not write durable
objects to application container filesystems: containers and release directories
can be replaced during deployment and recovery.

## Intake Before A File Feature

Record these product decisions before implementation:

- what users or operators upload or generate;
- whether each object is public, private, participant-only, operator-only, or
  shared with a named audience;
- which roles may create, view, replace, download, and delete it;
- maximum size, allowed MIME types, and required content inspection;
- image variants, dimensions, compression, cropping, or moderation;
- retention after account, Tender, or owning-record deletion;
- whether original filenames may be shown or stored;
- whether the feature is required for the current release.

Put ownership, retention, and privacy rules in the owning product brief/contract.
Do not infer them from bucket visibility or URL shape.

## Yandex Object Storage Defaults

- Use separate buckets or strict prefixes per environment and purpose.
- Use generated opaque object keys without names, logins, emails, Tender secrets,
  or other personal/sensitive data.
- Keep private objects private and issue short-lived presigned GET URLs only
  after backend authorization.
- Give public immutable variants versioned keys and long cache headers; serve
  them through the configured CDN origin.
- Configure browser-upload CORS for exact deployed origins and only required
  methods/headers.
- Restrict service-account permissions to the required buckets and operations.

Yandex Object Storage is S3-compatible and uses
`https://storage.yandexcloud.net`. Use `ru-central1` as the signing region unless
current provider documentation requires a different value.

## Backend Storage Boundary

The backend storage layer lives in `backend/src/storage` and owns:

- safe object-key generation;
- presigned PUT and GET URLs;
- public CDN URL construction;
- deletion and provider error translation.

Product modules own who may perform those operations and store ownership,
retention, audit, and lifecycle metadata in PostgreSQL when required.

The implementation retains `SPACES_*` environment key names from its original
S3-compatible adapter. Until a separately migrated provider-neutral contract is
implemented, use those keys with Yandex values:

```bash
SPACES_REGION=ru-central1
SPACES_BUCKET=<anomaly-detector-production-bucket>
SPACES_ENDPOINT=https://storage.yandexcloud.net
SPACES_CDN_BASE_URL=https://<public-media-domain>
SPACES_ACCESS_KEY_ID=<service-account-static-key-id>
SPACES_SECRET_ACCESS_KEY=<service-account-static-secret>
SPACES_UPLOAD_MAX_BYTES=10485760
SPACES_UPLOAD_URL_TTL_SECONDS=900
SPACES_DOWNLOAD_URL_TTL_SECONDS=300
SPACES_PUBLIC_CACHE_CONTROL="public, max-age=31536000, immutable"
```

Keep values in the protected runtime secret store, never Git, static builds,
screenshots, or release evidence. If one required adapter key is present, env
validation must reject an incomplete set.

## Direct Upload Flow

1. An authenticated client requests an upload intent with file metadata.
2. The owning backend use case checks actor, owner, audience, size, MIME type,
   quota, and target purpose.
3. The storage adapter returns a short-lived presigned PUT URL, required headers,
   opaque key, and signed content length when applicable.
4. The client uploads directly to Object Storage.
5. The client confirms the opaque key through the application API.
6. The backend verifies the object when strict stored size, MIME type, image
   dimensions, malware scanning, or moderation is required, then records product
   metadata in PostgreSQL.

The uploaded body must match a signed `contentLength`. Never trust a client path,
filename, MIME declaration, or confirmation call as proof of safe stored content.
Prefer storing object keys and deriving CDN/presigned URLs on the backend instead
of persisting provider URLs in product records.

## Images And Optimization

Store the original according to its privacy contract. Generate app-owned
thumbnail/responsive variants in the backend, worker, Cloud Function, or another
bounded job only when a real feature needs them. Store variants under stable
versioned keys such as `images/<owner-type>/<opaque-id>/<variant>.webp` and make
only explicitly public variants CDN-readable.

For simple fixed-size variants, evaluate Yandex Cloud Marketplace Image Resizer.
For dynamic transformation, evaluate a bounded Thumbor/imgproxy-style service or
an app-owned processor. Adding `sharp`, an image proxy, or a third-party media
service requires explicit product, cost, security, and operational justification.

## CDN And Caching

- Cache only public, audience-independent immutable objects in shared CDN caches.
- Use long cache headers with versioned keys; changing content creates a new key.
- Do not treat a hard-to-guess public URL as authorization.
- Do not rely on shared caching for private presigned URLs.
- Purge only for an urgent correction when immutable replacement cannot solve it.

## Deletion And Recovery

Define whether deletion is immediate, asynchronous, retained for recovery, or
legally delayed. Account and product-record deletion must not silently orphan
objects forever. Cleanup jobs must be idempotent, auditable, scoped to exact keys,
and safe against deleting an object whose ownership changed or was recreated.

Backups and database rollback do not automatically restore or roll back object
storage. A release or recovery plan involving object metadata must state how
database state and objects remain consistent.

## Alternative Provider

DigitalOcean Spaces remains an explicitly requested alternative and uses the same
S3-compatible boundary. Its deployment details live in
[DIGITALOCEAN.md](DIGITALOCEAN.md); do not mix provider endpoints, regions, CDN
behavior, or credentials in one environment.

## Current Upstream Documentation

- [Yandex Object Storage](https://yandex.cloud/en/docs/storage/)
- [Yandex Object Storage S3 API](https://yandex.cloud/en/docs/storage/s3/)
- [Yandex Cloud CDN](https://yandex.cloud/en/docs/cdn/)
- [Yandex Cloud Marketplace Image Resizer](https://yandex.cloud/en/marketplace/products/yc/image-resizer)
- [DigitalOcean Spaces](https://docs.digitalocean.com/products/spaces/)
