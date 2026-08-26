import { z } from 'zod'

export const MAX_CUSTOM_DOMAIN_MX_RECORDS = 8

const mailDomainSchema = z.string()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)

const approvedMailProviderIdSchema = z.enum([
  'beget',
  'rambler',
  'reg_ru',
  'spaceweb',
  'timeweb',
  'vk_mail',
  'yandex',
])

const mailAddressCanonicalizationSchema = z.object({
  ignoreDots: z.boolean(),
  localPartCaseInsensitive: z.boolean(),
  stripPlusTag: z.boolean(),
}).strict()

const approvedPublicMailDomainSchema = z.object({
  canonicalization: mailAddressCanonicalizationSchema,
  emailDomain: mailDomainSchema,
}).strict()

const approvedCustomMailDomainProfileSchema = z.object({
  allowedZones: z.array(z.enum(['ru', 'xn--p1ai'])).min(1).max(2),
  mxExchanges: z.array(mailDomainSchema).min(1).max(MAX_CUSTOM_DOMAIN_MX_RECORDS),
}).strict()

export const mailProviderDefinitionSchema = z.object({
  customDomain: approvedCustomMailDomainProfileSchema.nullable(),
  displayName: z.string().min(1).max(100),
  evidenceUrl: z.string().url().refine((value) => value.startsWith('https://')),
  providerId: approvedMailProviderIdSchema,
  publicDomains: z.array(approvedPublicMailDomainSchema).max(20),
}).strict()

export const mailProviderCatalogSchema = z.object({
  providers: z.array(mailProviderDefinitionSchema).min(1).max(100),
  version: z.number().int().positive(),
}).strict().superRefine((catalog, context) => {
  const providerIds = new Set<string>()
  const publicDomains = new Set<string>()
  const customMxProfiles = new Set<string>()

  for (const [providerIndex, provider] of catalog.providers.entries()) {
    if (providerIds.has(provider.providerId)) {
      context.addIssue({
        code: 'custom',
        message: 'Mail provider identifiers must be unique',
        path: ['providers', providerIndex, 'providerId'],
      })
    }
    providerIds.add(provider.providerId)

    for (const [domainIndex, publicDomain] of provider.publicDomains.entries()) {
      if (publicDomains.has(publicDomain.emailDomain)) {
        context.addIssue({
          code: 'custom',
          message: 'Public mail domains must be unique',
          path: ['providers', providerIndex, 'publicDomains', domainIndex, 'emailDomain'],
        })
      }
      publicDomains.add(publicDomain.emailDomain)
    }

    if (!provider.customDomain) continue
    if (new Set(provider.customDomain.allowedZones).size !== provider.customDomain.allowedZones.length) {
      context.addIssue({
        code: 'custom',
        message: 'Custom mail domain zones must be unique',
        path: ['providers', providerIndex, 'customDomain', 'allowedZones'],
      })
    }
    if (new Set(provider.customDomain.mxExchanges).size !== provider.customDomain.mxExchanges.length) {
      context.addIssue({
        code: 'custom',
        message: 'MX exchanges must be unique',
        path: ['providers', providerIndex, 'customDomain', 'mxExchanges'],
      })
    }
    const mxProfile = [...provider.customDomain.mxExchanges].sort().join('\u0000')
    if (customMxProfiles.has(mxProfile)) {
      context.addIssue({
        code: 'custom',
        message: 'Exact custom-domain MX profiles must be unique',
        path: ['providers', providerIndex, 'customDomain', 'mxExchanges'],
      })
    }
    customMxProfiles.add(mxProfile)
  }
})

export type ApprovedMailProviderId = z.infer<typeof approvedMailProviderIdSchema>
export type MailAddressCanonicalization = z.infer<typeof mailAddressCanonicalizationSchema>
export type MailProviderDefinition = z.infer<typeof mailProviderDefinitionSchema>
export type MailProviderCatalog = z.infer<typeof mailProviderCatalogSchema>
export type ApprovedPublicMailDomain = MailProviderDefinition['publicDomains'][number]
export type ApprovedCustomMailDomainProfile = NonNullable<MailProviderDefinition['customDomain']>
export type ApprovedMailProvider = MailProviderDefinition
export type ApprovedMailProviderCatalog = MailProviderCatalog

export const CONSERVATIVE_MAIL_CANONICALIZATION = Object.freeze({
  ignoreDots: false,
  localPartCaseInsensitive: false,
  stripPlusTag: false,
}) satisfies MailAddressCanonicalization

export const APPROVED_MAIL_PROVIDER_CATALOG = mailProviderCatalogSchema.parse({
  providers: [
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.hosting.reg.ru', 'mx2.hosting.reg.ru'],
      },
      displayName: 'REG.RU',
      evidenceUrl: 'https://help.reg.ru/support/hosting/nastroyka-pochty-regru/nastroyka-pochty-i-pochtovykh-kliyentovv/nastroyka-pochty-na-hostingee',
      providerId: 'reg_ru',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx.yandex.net'],
      },
      displayName: 'Яндекс',
      evidenceUrl: 'https://yandex.ru/support/yandex-360/business/admin/ru/domains/dns/mx',
      providerId: 'yandex',
      publicDomains: [
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'yandex.ru',
        },
      ],
    },
    {
      customDomain: {
        allowedZones: ['ru'],
        mxExchanges: ['emx.mail.ru'],
      },
      displayName: 'VK Почта',
      evidenceUrl: 'https://workspace.vk.ru/docs/saas/get-started/setup/mx-record',
      providerId: 'vk_mail',
      publicDomains: [
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'mail.ru',
        },
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'inbox.ru',
        },
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'bk.ru',
        },
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'list.ru',
        },
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'internet.ru',
        },
      ],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.timeweb.ru', 'mx2.timeweb.ru'],
      },
      displayName: 'Timeweb',
      evidenceUrl: 'https://timeweb.com/ru/docs/chasto-zadavaemye-voprosy/pochta-faq/',
      providerId: 'timeweb',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.beget.com', 'mx2.beget.com'],
      },
      displayName: 'Beget',
      evidenceUrl: 'https://beget.com/ru/kb/manual/dns',
      providerId: 'beget',
      publicDomains: [],
    },
    {
      customDomain: {
        allowedZones: ['ru', 'xn--p1ai'],
        mxExchanges: ['mx1.spaceweb.ru', 'mx2.spaceweb.ru'],
      },
      displayName: 'SpaceWeb',
      evidenceUrl: 'https://help.sweb.ru/sozdanie-i-nastrojka-pochty_1298.html',
      providerId: 'spaceweb',
      publicDomains: [],
    },
    {
      customDomain: null,
      displayName: 'Рамблер/почта',
      evidenceUrl: 'https://help.rambler.ru/mail/mail-legal/2395',
      providerId: 'rambler',
      publicDomains: [
        {
          canonicalization: CONSERVATIVE_MAIL_CANONICALIZATION,
          emailDomain: 'rambler.ru',
        },
      ],
    },
  ],
  version: 1,
})
