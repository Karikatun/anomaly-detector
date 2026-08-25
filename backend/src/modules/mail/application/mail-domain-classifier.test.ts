import { describe, expect, test } from 'bun:test'

import {
  MAX_CUSTOM_DOMAIN_MX_RECORDS,
  classifyMailDomain,
} from './mail-domain-classifier'

describe('approved public mail domains', () => {
  test.each([
    ['YANDEX.RU.', 'yandex'],
    ['mail.ru', 'vk_mail'],
    ['inbox.ru', 'vk_mail'],
    ['bk.ru', 'vk_mail'],
    ['list.ru', 'vk_mail'],
    ['internet.ru', 'vk_mail'],
    ['rambler.ru', 'rambler'],
  ] as const)('allows exact public domain %s without consulting MX', (emailDomain, providerId) => {
    expect(classifyMailDomain({
      emailDomain,
      mx: { kind: 'retry', reason: 'dns_unavailable' },
    })).toEqual({
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      emailDomain: emailDomain === 'YANDEX.RU.' ? 'yandex.ru' : emailDomain,
      kind: 'allowed',
      providerId,
      source: 'public_domain',
    })
  })

  test('does not invent adjacent public aliases', () => {
    expect(classifyMailDomain({
      emailDomain: 'ya.ru',
      mx: { kind: 'no_mx' },
    })).toEqual({
      emailDomain: 'ya.ru',
      kind: 'denied',
      reason: 'no_mx',
    })
  })
})

describe('custom RU and RF domains', () => {
  test.each([
    [['MX2.HOSTING.REG.RU.', 'mx1.hosting.reg.ru'], 'reg_ru'],
    [['mx.yandex.net'], 'yandex'],
    [['emx.mail.ru'], 'vk_mail'],
    [['mx2.timeweb.ru', 'mx1.timeweb.ru'], 'timeweb'],
    [['mx1.beget.com', 'mx2.beget.com'], 'beget'],
    [['mx2.spaceweb.ru', 'mx1.spaceweb.ru'], 'spaceweb'],
  ] as const)('allows a normalized exact full MX RRset %o', (exchanges, providerId) => {
    expect(classifyMailDomain({
      emailDomain: 'Company.RU.',
      mx: { exchanges, kind: 'resolved' },
    })).toEqual({
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      emailDomain: 'company.ru',
      kind: 'allowed',
      mxExchanges: [...new Set(exchanges.map((exchange) => exchange.toLowerCase().replace(/\.$/, '')))].sort(),
      providerId,
      source: 'mx',
    })
  })

  test('normalizes an RF IDNA domain and duplicate RRset records', () => {
    expect(classifyMailDomain({
      emailDomain: 'Пример.РФ',
      mx: {
        exchanges: ['mx.yandex.net', 'MX.YANDEX.NET.'],
        kind: 'resolved',
      },
    })).toEqual({
      canonicalization: {
        ignoreDots: false,
        localPartCaseInsensitive: false,
        stripPlusTag: false,
      },
      emailDomain: 'xn--e1afmkfd.xn--p1ai',
      kind: 'allowed',
      mxExchanges: ['mx.yandex.net'],
      providerId: 'yandex',
      source: 'mx',
    })
  })

  test('denies VK WorkSpace for an RF address domain outside its reviewed profile', () => {
    expect(classifyMailDomain({
      emailDomain: 'пример.рф',
      mx: { exchanges: ['emx.mail.ru'], kind: 'resolved' },
    })).toEqual({
      emailDomain: 'xn--e1afmkfd.xn--p1ai',
      kind: 'denied',
      reason: 'unsupported_zone',
    })
  })

  test('denies matching mail infrastructure outside RU and RF address zones', () => {
    expect(classifyMailDomain({
      emailDomain: 'company.com',
      mx: { exchanges: ['mx.yandex.net'], kind: 'resolved' },
    })).toEqual({
      emailDomain: 'company.com',
      kind: 'denied',
      reason: 'unsupported_zone',
    })
  })

  test.each([
    [{ kind: 'no_mx' } as const, 'no_mx'],
    [{ kind: 'null_mx' } as const, 'null_mx'],
    [{ exchanges: [], kind: 'resolved' } as const, 'no_mx'],
    [{ exchanges: ['.'], kind: 'resolved' } as const, 'null_mx'],
    [{ exchanges: ['mx.yandex.net', '.'], kind: 'resolved' } as const, 'null_mx'],
    [{ kind: 'too_many_records' } as const, 'too_many_mx_records'],
    [{ kind: 'invalid_records' } as const, 'invalid_mx_record'],
  ] as const)('denies an unusable MX result %o', (mx, reason) => {
    expect(classifyMailDomain({ emailDomain: 'company.ru', mx })).toEqual({
      emailDomain: 'company.ru',
      kind: 'denied',
      reason,
    })
  })

  test('preserves a temporary DNS failure as retryable', () => {
    expect(classifyMailDomain({
      emailDomain: 'company.ru',
      mx: { kind: 'retry', reason: 'dns_timeout' },
    })).toEqual({
      emailDomain: 'company.ru',
      kind: 'retry',
      reason: 'dns_timeout',
    })
  })

  test.each([
    [['mx1.hosting.reg.ru'], 'mx_profile_mismatch'],
    [['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru', 'extra.example.ru'], 'mx_profile_mismatch'],
    [['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru', 'mx1.timeweb.ru', 'mx2.timeweb.ru'], 'mixed_providers'],
    [['aspmx.l.google.com'], 'unknown_provider'],
    [['mail.company.ru'], 'unknown_provider'],
    [['not a domain'], 'invalid_mx_record'],
  ] as const)('denies a non-exact or unknown RRset %o', (exchanges, reason) => {
    expect(classifyMailDomain({
      emailDomain: 'company.ru',
      mx: { exchanges, kind: 'resolved' },
    })).toEqual({
      emailDomain: 'company.ru',
      kind: 'denied',
      reason,
    })
  })

  test('bounds raw MX records before normalization', () => {
    expect(classifyMailDomain({
      emailDomain: 'company.ru',
      mx: {
        exchanges: Array.from(
          { length: MAX_CUSTOM_DOMAIN_MX_RECORDS + 1 },
          (_, index) => `mx${index}.example.ru`,
        ),
        kind: 'resolved',
      },
    })).toEqual({
      emailDomain: 'company.ru',
      kind: 'denied',
      reason: 'too_many_mx_records',
    })
  })

  test('fails closed before DNS classification for an invalid address domain', () => {
    expect(classifyMailDomain({
      emailDomain: 'not a domain',
      mx: { exchanges: ['mx.yandex.net'], kind: 'resolved' },
    })).toEqual({
      emailDomain: null,
      kind: 'denied',
      reason: 'invalid_domain',
    })
  })
})
