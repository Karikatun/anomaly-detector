import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import ts from 'typescript'

import { messages } from '../src/platform/i18n/translations'

const CYRILLIC = /[А-Яа-яЁё]/u
const PLAYER_COPY = /[A-Za-zА-Яа-яЁё]/u
const SOURCE_FILE = /\.(?:ts|tsx)$/u
const PLAYER_COPY_ATTRIBUTES = new Set(['alt', 'aria-label', 'placeholder', 'title'])
const NUMERIC_KEY_PATTERN = /\.copy\.\d+$/u
const numericKeyBaselineRanges = {
  'tender.accessSlotPanel': [1],
  'tender.completedTenderPanel': [...range(1, 119), 124],
  'tender.contractsPanel': range(1, 31),
  'tender.finalScientificModelPanel': range(1, 35),
  'tender.laboratoryPanel': range(1, 17),
  'tender.modelAnalysisPanel': range(1, 5),
  'tender.phase-ui': range(1, 14),
  'tender.powerAllocationPanel': [1],
  'tender.reconnaissancePanel': range(1, 17),
  'tender.reconnectOverlay': range(1, 5),
  'tender.tender-command-feedback': range(1, 5),
  'tender.tenderOverview': range(1, 41),
  'tender.tenderPage': range(1, 35),
  'tender.tenderPhaseProgress': range(1, 6),
  'tender.tenderResearchDialog': range(1, 4),
  'tender.tenderTimer': [1],
  'tender.working-model-draft': [1],
  'tender.workingModelPanel': range(1, 6),
  'tender.workingModelWorkspace': range(1, 5),
}
export const numericTranslationKeyBaseline = new Set(
  Object.entries(numericKeyBaselineRanges).flatMap(([namespace, numbers]) =>
    numbers.map((number) => `${namespace}.copy.${String(number).padStart(3, '0')}`),
  ),
)
const APPROVED_TECHNICAL_LITERALS = new Map([
  ['src/features/legal/LegalDocumentPage.tsx', new Set([
    '**Версия согласия:**',
    '## 1. Общие положения',
    '**Версия соглашения:**',
  ])],
])

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export function findNewNumericMessageKeys({ allowedKeys, messageCatalog }) {
  return Object.keys(messageCatalog)
    .filter((key) => NUMERIC_KEY_PATTERN.test(key) && !allowedKeys.has(key))
    .sort()
}

function isMessageResource(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  return normalized.includes('/platform/i18n/messages/')
    || normalized.endsWith('/platform/i18n/translations.ts')
}

function findingFor(sourceFile, node, text) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    column: position.character + 1,
    line: position.line + 1,
    text: text.trim(),
  }
}

function isApprovedTechnicalLiteral(filePath, text) {
  const normalized = filePath.replaceAll('\\', '/')
  return APPROVED_TECHNICAL_LITERALS.get(normalized)?.has(text.trim()) ?? false
}

function isPlayerCopyAttribute(node) {
  return ts.isStringLiteral(node)
    && ts.isJsxAttribute(node.parent)
    && ts.isIdentifier(node.parent.name)
    && PLAYER_COPY_ATTRIBUTES.has(node.parent.name.text)
}

export function findUntranslatedCyrillic({ filePath, source }) {
  if (isMessageResource(filePath)) return []

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings = []

  function visit(node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && (CYRILLIC.test(node.text) || (isPlayerCopyAttribute(node) && PLAYER_COPY.test(node.text)))
      && !isApprovedTechnicalLiteral(filePath, node.text)
    ) {
      findings.push(findingFor(sourceFile, node, node.text))
    } else if (ts.isJsxText(node) && PLAYER_COPY.test(node.text)) {
      findings.push(findingFor(sourceFile, node, node.text))
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head, ...node.templateSpans.map((span) => span.literal)]
      for (const part of parts) {
        if (CYRILLIC.test(part.text)) findings.push(findingFor(sourceFile, part, part.text))
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

export function findUnknownTranslationKeys({ filePath, knownKeys, source }) {
  if (isMessageResource(filePath)) return []

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings = []

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 't' || node.expression.text === 'translate')
      && ts.isStringLiteral(node.arguments[0])
      && !knownKeys.has(node.arguments[0].text)
    ) {
      findings.push(findingFor(sourceFile, node.arguments[0], node.arguments[0].text))
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

export function findInvalidTranslationParams({ filePath, messageCatalog, source }) {
  if (isMessageResource(filePath)) return []

  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings = []

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 't' || node.expression.text === 'translate')
      && ts.isStringLiteral(node.arguments[0])
      && messageCatalog[node.arguments[0].text]
    ) {
      const placeholders = [...messageCatalog[node.arguments[0].text].matchAll(/\{([A-Za-z0-9_]+)\}/gu)]
        .map((match) => match[1])
      if (placeholders.length > 0) {
        const params = node.arguments[1]
        const provided = new Set()
        if (ts.isObjectLiteralExpression(params)) {
          for (const property of params.properties) {
            if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
              provided.add(property.name.getText(sourceFile).replace(/^['"]|['"]$/gu, ''))
            }
          }
        }
        const missing = [...new Set(placeholders)].filter((placeholder) => !provided.has(placeholder))
        if (missing.length > 0) {
          const finding = findingFor(sourceFile, node.arguments[0], node.arguments[0].text)
          findings.push({ ...finding, text: `${node.arguments[0].text}: missing ${missing.join(', ')}` })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (SOURCE_FILE.test(entry.name)) files.push(path)
  }

  return files
}

async function run() {
  const root = resolve(import.meta.dir, '..')
  const files = await sourceFiles(resolve(root, 'src'))
  const findings = []
  const knownKeys = new Set(Object.keys(messages))

  for (const key of findNewNumericMessageKeys({
    allowedKeys: numericTranslationKeyBaseline,
    messageCatalog: messages,
  })) {
    findings.push(`src/platform/i18n/messages: new numeric translation key: ${JSON.stringify(key)}`)
  }

  for (const filePath of files) {
    const displayPath = relative(root, filePath)
    const source = await readFile(filePath, 'utf8')
    for (const finding of findUntranslatedCyrillic({ filePath: displayPath, source })) {
      findings.push(`${displayPath}:${finding.line}:${finding.column} untranslated player copy: ${JSON.stringify(finding.text)}`)
    }
    for (const finding of findUnknownTranslationKeys({ filePath: displayPath, knownKeys, source })) {
      findings.push(`${displayPath}:${finding.line}:${finding.column} unknown translation key: ${JSON.stringify(finding.text)}`)
    }
    for (const finding of findInvalidTranslationParams({ filePath: displayPath, messageCatalog: messages, source })) {
      findings.push(`${displayPath}:${finding.line}:${finding.column} invalid translation params: ${JSON.stringify(finding.text)}`)
    }
  }

  if (findings.length > 0) {
    console.error(findings.join('\n'))
    process.exitCode = 1
    return
  }

  console.log('i18n source audit passed')
}

if (import.meta.main) await run()
