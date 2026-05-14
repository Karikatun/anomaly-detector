import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const srcRoot = resolve(import.meta.dir, '../src');
const typographyComponent = 'components/ui/typography.tsx';
const typographyScaleFiles = new Set([typographyComponent, 'components/ui/theme.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

test('Typography exposes the complete mobile type scale', () => {
  const source = readFileSync(resolve(srcRoot, typographyComponent), 'utf8');
  const expectedVariants = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'bodyXl',
    'bodyLg',
    'body',
    'bodySm',
    'bodyXs',
    'caption',
    'label',
    'button',
    'link',
    'code',
  ];

  for (const variant of expectedVariants) {
    expect(source).toContain(`'${variant}'`);
  }
});

test('mobile source renders text only through Typography', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(srcRoot)) {
    const relativePath = relative(srcRoot, file);
    const source = readFileSync(file, 'utf8');

    if (relativePath !== typographyComponent) {
      if (/import\s*\{[^}]*\bText\b[^}]*\}\s*from ['"]react-native['"]/.test(source)) {
        offenders.push(`${relativePath}: imports React Native Text`);
      }

      if (/<\/?Text(?=[\s>])/.test(source)) {
        offenders.push(`${relativePath}: renders <Text> directly`);
      }

      const namespaceImports = [...source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from ['"]react-native['"]/g)];
      for (const [, namespace] of namespaceImports) {
        if (new RegExp(`<\\/?${namespace}\\.Text(?=[\\s>])`).test(source)) {
          offenders.push(`${relativePath}: renders <${namespace}.Text> directly`);
        }
      }
    }

    if (/\b(?:UiText|ThemedText)\b/.test(source)) {
      offenders.push(`${relativePath}: uses a legacy text component`);
    }

    if (!typographyScaleFiles.has(relativePath)) {
      if (/\b(?:fontSize|fontWeight|lineHeight|letterSpacing)\b/.test(source)) {
        offenders.push(`${relativePath}: defines typography style outside Typography`);
      }
    }
  }

  expect(offenders).toEqual([]);
});
