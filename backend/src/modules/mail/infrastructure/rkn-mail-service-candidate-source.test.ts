import { expect, test } from 'bun:test'

import {
  RknMailServiceCandidateSource,
  RknMailSourceFailure,
} from './rkn-mail-service-candidate-source'

const metadata = `"property","value"\r
"identifier","7705846236-InformationDistributor"\r
"format","XML"\r
"modified","2026-08-20"\r
"data-20260820T0000-structure-20161206T0000","https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data-20260820T0000-structure-20161206T0000.xml"\r
"structure-20161206T0000","https://rkn.gov.ru/opendata/7705846236-InformationDistributor/structure-20161206T0000.xsd"\r
`

const registryXml = `<?xml version="1.0" encoding="UTF-8"?>
<rkn:register xmlns:rkn="http://rsoc.ru/opendata/7705846236-InformationDistributor">
  <rkn:record>
    <rkn:entryNum>1-PP</rkn:entryNum>
    <rkn:entryDate>2014-09-12</rkn:entryDate>
    <rkn:distributorName>Private registry subject</rkn:distributorName>
    <rkn:distributorEmail>private@example.test</rkn:distributorEmail>
    <rkn:services>
      <rkn:service>
        <rkn:domain>Mail.Yandex.RU.</rkn:domain>
        <rkn:description>Сервис электронной почты</rkn:description>
        <rkn:email>private@example.test</rkn:email>
        <rkn:accessLimited>false</rkn:accessLimited>
      </rkn:service>
      <rkn:service>
        <rkn:domain>maps.yandex.ru</rkn:domain>
        <rkn:description>Картографический сервис</rkn:description>
        <rkn:email>private@example.test</rkn:email>
        <rkn:accessLimited>false</rkn:accessLimited>
      </rkn:service>
    </rkn:services>
  </rkn:record>
</rkn:register>`

test('imports only bounded mail-service candidates from the official metadata target', async () => {
  const requested: string[] = []
  const source = new RknMailServiceCandidateSource(async (input) => {
    const url = String(input)
    requested.push(url)
    if (url.endsWith('/meta.csv')) return textResponse(metadata)
    if (url.endsWith('.xml')) return textResponse(registryXml)
    return new Response(null, { status: 404 })
  })

  const result = await source.load()

  expect(requested).toEqual([
    'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/meta.csv',
    'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data-20260820T0000-structure-20161206T0000.xml',
  ])
  expect(result).toMatchObject({
    candidates: [{
      evidence: 'service_description_mentions_mail',
      registryEntryId: '1-PP',
      serviceDomain: 'mail.yandex.ru',
    }],
    checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    sourceDate: '2026-08-20',
    sourceUrl: requested[1],
  })
  expect(JSON.stringify(result)).not.toContain('Private registry subject')
  expect(JSON.stringify(result)).not.toContain('private@example.test')
})

test('fails closed when metadata leaves the source boundary or XML adds an unknown element', async () => {
  const offBoundaryMetadata = metadata.replace(
    'https://rkn.gov.ru/opendata/7705846236-InformationDistributor/data-',
    'https://attacker.example/opendata/7705846236-InformationDistributor/data-',
  )
  const offBoundary = new RknMailServiceCandidateSource(async () => textResponse(offBoundaryMetadata))
  await expect(offBoundary.load()).rejects.toMatchObject({
    code: 'source_boundary_invalid',
  } satisfies Partial<RknMailSourceFailure>)

  const unknownXml = registryXml.replace(
    '<rkn:description>Сервис электронной почты</rkn:description>',
    '<rkn:description>Сервис электронной почты<unsafe>payload</unsafe></rkn:description>',
  )
  const unknownElement = new RknMailServiceCandidateSource(async (input) =>
    String(input).endsWith('/meta.csv') ? textResponse(metadata) : textResponse(unknownXml))
  await expect(unknownElement.load()).rejects.toMatchObject({
    code: 'registry_invalid',
  } satisfies Partial<RknMailSourceFailure>)
})

test('rejects an otherwise valid snapshot when it yields no mail-service candidates', async () => {
  const emptyRegistry = registryXml.replace(
    'Сервис электронной почты',
    'Картографический сервис',
  )
  const source = new RknMailServiceCandidateSource(async (input) =>
    String(input).endsWith('/meta.csv') ? textResponse(metadata) : textResponse(emptyRegistry))

  await expect(source.load()).rejects.toMatchObject({
    code: 'empty_candidates',
  } satisfies Partial<RknMailSourceFailure>)
})

function textResponse(body: string) {
  return new Response(body, {
    headers: {
      'Content-Length': String(new TextEncoder().encode(body).byteLength),
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
