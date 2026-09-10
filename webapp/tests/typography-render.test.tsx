import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button } from '../src/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '../src/components/ui/dialog'

test('Radix primitives keep child slots and Typography classes at runtime', () => {
  const markup = renderToStaticMarkup(
    <>
      <Button asChild className="text-background">
        <a href="/settings">Settings</a>
      </Button>
      <Dialog>
        <DialogTitle className="custom-title">Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
      </Dialog>
    </>,
  )

  expect(markup).toContain('href="/settings"')
  expect(markup).toContain('data-slot="button"')
  expect(markup).toContain('text-background')
  expect(markup).toContain('text-sm leading-none font-medium')

  expect(markup).toContain('data-slot="dialog-title"')
  expect(markup).toContain('custom-title')
  expect(markup).toContain('font-heading text-base')

  expect(markup).toContain('data-slot="dialog-description"')
  expect(markup).toContain('text-muted-foreground')

  expect(markup).not.toContain('data-slot="typography"')
})
