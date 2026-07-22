// A static file server for the Storybook build, small enough to avoid adding a
// dependency for something Playwright only needs for the length of a run.

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(process.argv[2])
const port = Number(process.argv[3])

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://127.0.0.1')
  // `normalize` collapses any `..` before the path is joined, so a request can
  // never reach outside the Storybook build.
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, relative)

  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
  } catch {
    response.writeHead(404).end('Not found')
    return
  }

  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1')
