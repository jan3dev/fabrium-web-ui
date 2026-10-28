import { describe, expect, it } from 'vitest'
import { mimeFromFilename } from './mime.js'

describe('mimeFromFilename', () => {
  it.each([
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'image/webp'],
    ['a.svg', 'image/svg+xml'],
    ['a.pdf', 'application/pdf'],
    ['a.txt', 'text/plain'],
    ['a.log', 'text/plain'],
    ['a.md', 'text/markdown'],
    ['a.csv', 'text/csv'],
    ['a.json', 'application/json'],
    ['a.html', 'text/html'],
    ['a.zip', 'application/zip'],
    ['REPORT.PDF', 'application/pdf'],
    ['Makefile', 'application/octet-stream'],
    ['a.tar.gz', 'application/octet-stream'],
  ])('%s → %s', (name, mime) => {
    expect(mimeFromFilename(name)).toBe(mime)
  })
})
