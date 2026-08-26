import { expect, test } from 'bun:test'

import {
  APPROVED_MAIL_PROVIDER_CATALOG,
  mailProviderCatalogSchema,
} from './approved-mail-provider-catalog'

test('defines a versioned catalog with only the reviewed provider profiles', () => {
  expect(APPROVED_MAIL_PROVIDER_CATALOG.version).toBe(1)
  expect(APPROVED_MAIL_PROVIDER_CATALOG.providers.map((provider) => ({
    customDomain: provider.customDomain,
    providerId: provider.providerId,
    publicDomains: provider.publicDomains.map(({ emailDomain }) => emailDomain),
  }))).toEqual([
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'],
      },
      providerId: 'reg_ru',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx.yandex.net'],
      },
      providerId: 'yandex',
      publicDomains: ['yandex.ru'],
    },
    {
      customDomain: {
        allowedZones: ['ru'],
        mxExchanges: ['emx.mail.ru'],
      },
      providerId: 'vk_mail',
      publicDomains: ['mail.ru', 'inbox.ru', 'bk.ru', 'list.ru', 'internet.ru'],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.timeweb.ru', 'mx2.timeweb.ru'],
      },
      providerId: 'timeweb',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.beget.com', 'mx2.beget.com'],
      },
      providerId: 'beget',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.spaceweb.ru', 'mx2.spaceweb.ru'],
      },
      providerId: 'spaceweb',
      publicDomains: [],
    },
    {
      customDomain: null,
      providerId: 'rambler',
      publicDomains: ['rambler.ru'],
    },
  ])
})

test('keeps public-domain canonicalization conservative and evidence attributable', () => {
  for (const provider of APPROVED_MAIL_PROVIDER_CATALOG.providers) {
    expect(provider.displayName.length).toBeGreaterThan(0)
    expect(new URL(provider.evidenceUrl).protocol).toBe('https:')
    for (const publicDomain of provider.publicDomains) {
      expect(publicDomain.canonicalization).toEqual({
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      })
    }
  }
})

test('strictly parses the catalog persistence shape and rejects unknown fields', () => {
  expect(mailProviderCatalogSchema.parse(APPROVED_MAIL_PROVIDER_CATALOG))
    .toEqual(APPROVED_MAIL_PROVIDER_CATALOG)

  expect(mailProviderCatalogSchema.safeParse({
    ...APPROVED_MAIL_PROVIDER_CATALOG,
    unexpected: true,
  }).success).toBeFalse()

  expect(mailProviderCatalogSchema.safeParse({
    ...APPROVED_MAIL_PROVIDER_CATALOG,
    providers: [{
      ...APPROVED_MAIL_PROVIDER_CATALOG.providers[0],
      unexpected: true,
    }],
  }).success).toBeFalse()
})

test('rejects MX profiles that the runtime cannot classify unambiguously', () => {
  const firstProvider = APPROVED_MAIL_PROVIDER_CATALOG.providers[0]
  const secondProvider = APPROVED_MAIL_PROVIDER_CATALOG.providers[1]
  if (!firstProvider?.customDomain || !secondProvider?.customDomain) {
    throw new Error('Expected reviewed custom-domain provider profiles')
  }

  expect(mailProviderCatalogSchema.safeParse({
    ...APPROVED_MAIL_PROVIDER_CATALOG,
    providers: [{
      ...firstProvider,
      customDomain: {
        ...firstProvider.customDomain,
        mxExchanges: Array.from({ length: 9 }, (_, index) => `mx${index}.example.ru`),
      },
    }],
  }).success).toBeFalse()

  expect(mailProviderCatalogSchema.safeParse({
    ...APPROVED_MAIL_PROVIDER_CATALOG,
    providers: [
      firstProvider,
      {
        ...secondProvider,
        customDomain: {
          ...secondProvider.customDomain,
          mxExchanges: [...firstProvider.customDomain.mxExchanges].reverse(),
        },
      },
    ],
  }).success).toBeFalse()
})
