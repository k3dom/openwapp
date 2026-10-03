import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from '@effect/vitest'
import fingerprints from '@openwapp/fingerprints'
import {
  Catalog,
  Observation,
  Requirements,
  type Rule,
} from '@openwapp/matcher'
import { Deferred, Duration, Effect, Fiber, Layer } from 'effect'
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'

import * as Certificate from '#/certificate.ts'
import * as Collector from '#/collector.ts'
import * as Page from '#/page.ts'
import * as Resolver from '#/resolver.ts'

const catalogOf = (technologies: Record<string, object>) =>
  Catalog.decodeSync({
    technologies: Object.fromEntries(
      Object.entries(technologies).map(([name, technology]) => [
        name,
        { cats: [1], website: 'https://example.com', ...technology },
      ])
    ),
    categories: { 1: { name: 'CMS', priority: 1, groups: [1] } },
    groups: { 1: { name: 'Content' } },
  })

const requirementsOf = (technologies: Record<string, object>) =>
  Requirements.fromCatalog(catalogOf(technologies))

const site = (
  routes: Record<string, () => Response | Error>,
  {
    records = {},
    issuers = {},
    otherwise = () => new Response(null, { status: 404 }),
  }: {
    readonly records?: Record<
      string,
      Partial<Record<Rule.DnsRecordType, ReadonlyArray<string> | Error>>
    >
    readonly issuers?: Record<string, () => string | Error>
    readonly otherwise?: () => Response | Error
  } = {}
) => {
  const resolved: Array<string> = []
  const resolverLayer = Layer.succeed(Resolver.Resolver, {
    resolve: (hostname, type) => {
      resolved.push(`${type} ${hostname}`)
      const found = records[hostname]?.[type] ?? []
      return found instanceof Error
        ? Effect.fail(
            new Resolver.ResolverError({ hostname, type, cause: found })
          )
        : Effect.succeed(found)
    },
  })
  const requested: Array<string> = []
  const certificateRequests: Array<string> = []
  const headers: Array<Record<string, string>> = []
  const client = HttpClient.make((request, url) => {
    requested.push(url.href)
    headers.push(request.headers)
    const response = routes[url.href]?.() ?? otherwise()
    return response instanceof Error
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: response,
            }),
          })
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, response))
  })
  const clientLayer = Layer.succeed(HttpClient.HttpClient, client)
  const certificateLayer = Layer.succeed(Certificate.Certificate, {
    issuer: (url) => {
      certificateRequests.push(url.href)
      const issuer =
        issuers[url.origin]?.() ?? new Error('certificate unavailable')
      return issuer instanceof Error
        ? Effect.fail(
            new Certificate.CertificateError({ url: url.href, cause: issuer })
          )
        : Effect.succeed(issuer)
    },
  })
  return {
    requested,
    headers,
    certificateRequests,
    resolved,
    clientLayer,
    certificateLayer,
    resolverLayer,
    layer: Layer.mergeAll(Page.layerHttp, certificateLayer, resolverLayer).pipe(
      Layer.provideMerge(clientLayer)
    ),
  }
}

const serve = async (listener: RequestListener) => {
  const server = createServer(listener)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

const endless = (text: string) => {
  const chunk = new TextEncoder().encode(text.repeat(64 * 1024))
  const stream = { cancelled: false }
  return {
    stream,
    response: () =>
      new Response(
        new ReadableStream({
          pull: (controller) => controller.enqueue(chunk),
          cancel: () => {
            stream.cancelled = true
          },
        })
      ),
  }
}

describe('Collector.collect', () => {
  it.effect('observes the url, headers, cookies and html of the page', () => {
    const headers = new Headers({ server: 'nginx', 'x-powered-by': 'PHP' })
    headers.append('set-cookie', 'PHPSESSID=abc; Path=/')
    headers.append('set-cookie', 'Lang=en')
    const { layer } = site({
      'https://example.com/': () => new Response('<html></html>', { headers }),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({})
      )
      expect(observation).toBeInstanceOf(Observation.Observation)
      expect(observation.url).toEqual(['https://example.com/'])
      expect(observation.html).toEqual(['<html></html>'])
      expect(observation.header.get('server')).toEqual(['nginx'])
      expect(observation.header.get('x-powered-by')).toEqual(['PHP'])
      expect(observation.cookie).toEqual(
        new Map([
          ['phpsessid', ['abc']],
          ['lang', ['en']],
        ])
      )
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'observes cookies with attributes that cannot be serialized',
    () => {
      const { layer } = site({
        'https://example.com/': () =>
          new Response('', { headers: { 'set-cookie': 'Id=1; Path=/café' } }),
      })
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({})
        )
        expect(observation.cookie).toEqual(new Map([['id', ['1']]]))
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect.each<[string, string | undefined, Uint8Array, string]>([
    [
      'the charset of the content-type header',
      'text/html; charset=ISO-8859-1',
      Buffer.from('<p>Café</p>', 'latin1'),
      '<p>Café</p>',
    ],
    [
      'a quoted charset of the content-type header',
      'text/html;charset="Shift_JIS"',
      Buffer.from([0x93, 0xfa, 0x96, 0x7b]),
      '日本',
    ],
    [
      'a meta charset',
      'text/html',
      Buffer.concat([
        Buffer.from('<meta charset="shift_jis"><p>'),
        Buffer.from([0x93, 0xfa, 0x96, 0x7b]),
      ]),
      '<meta charset="shift_jis"><p>日本',
    ],
    [
      'a meta http-equiv content-type',
      undefined,
      Buffer.concat([
        Buffer.from(
          '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1252">'
        ),
        Buffer.from([0x80]),
      ]),
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1252">€',
    ],
    [
      'the last charset of repeated content-type headers',
      'text/html; charset=utf-8, text/html; charset=iso-8859-1, text/html',
      Buffer.from('Café', 'latin1'),
      'Café',
    ],
    [
      'a single quoted charset of the content-type header',
      "text/html; charset='iso-8859-1'",
      Buffer.from('Café', 'latin1'),
      'Café',
    ],
    [
      'the replacement encoding',
      'text/html; charset=iso-2022-kr',
      Buffer.from('<p>page</p>'),
      '\uFFFD',
    ],
    [
      'utf-8 when the meta charset comes after the first 1024 bytes',
      'text/html',
      Buffer.from(
        `<body><!--${'-'.repeat(1024)}--><meta charset="iso-8859-1">Café`,
        'latin1'
      ),
      `<body><!--${'-'.repeat(1024)}--><meta charset="iso-8859-1">Caf\uFFFD`,
    ],
    [
      'the content-type header over a meta charset',
      'text/html; charset=utf-8',
      Buffer.from('<meta charset="iso-8859-1">Café'),
      '<meta charset="iso-8859-1">Café',
    ],
    [
      'a meta charset when the content-type header has an unknown charset',
      'text/html; charset=unknown',
      Buffer.from('<meta charset="iso-8859-1">Café', 'latin1'),
      '<meta charset="iso-8859-1">Café',
    ],
    [
      'the byte order mark over the content-type header',
      'text/html; charset=iso-8859-1',
      Buffer.from('\uFEFFCafé'),
      'Café',
    ],
    ['utf-8 without a declaration', 'text/html', Buffer.from('Café'), 'Café'],
  ])('decodes the page in %s', ([, contentType, body, html]) => {
    const { layer } = site({
      'https://example.com/': () =>
        new Response(
          body,
          contentType === undefined
            ? {}
            : { headers: { 'content-type': contentType } }
        ),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({})
      )
      expect(observation.html).toEqual([html])
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'extracts what the catalog asks for from a page in a legacy encoding',
    () => {
      const { layer } = site({
        'https://example.com/': () =>
          new Response(
            Buffer.from(
              '<meta charset="windows-1252"><meta name="generator" content="Café 1.0"><p>Café</p>',
              'latin1'
            ),
            { headers: { 'content-type': 'text/html' } }
          ),
      })
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({
            Example: {
              text: ['Café'],
              meta: { generator: 'Café' },
              dom: { p: { text: 'Café' } },
            },
          })
        )
        expect(observation.text).toEqual(['Café'])
        expect(observation.meta).toEqual(new Map([['generator', ['Café 1.0']]]))
        expect(observation.domText).toEqual(new Map([['p', ['Café']]]))
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('follows redirects to the final url', () => {
    const { layer } = site({
      'http://example.com/': () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://example.com/home' },
        }),
      'https://example.com/home': () => new Response('home'),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'http://example.com/',
        requirementsOf({})
      )
      expect(observation.url).toEqual(['https://example.com/home'])
      expect(observation.html).toEqual(['home'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('observes a page whatever its status', () => {
    const { layer } = site({
      'https://example.com/': () =>
        new Response('blocked', { status: 403, headers: { server: 'cdn' } }),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({})
      )
      expect(observation.header.get('server')).toEqual(['cdn'])
      expect(observation.html).toEqual(['blocked'])
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'extracts what the catalog asks for from the html of the page',
    () => {
      const { layer } = site({
        'http://example.com/': () =>
          new Response(null, {
            status: 301,
            headers: { location: 'https://www.example.org/shop/' },
          }),
        'https://www.example.org/shop/': () =>
          new Response(
            `<html><head>
            <meta name="generator" content="Example 1.0">
            <style>.example-class {}</style>
            <script src="example.js"></script>
            <script>window.example = true</script>
          </head><body><div id="example" data-version="1.0">Example shop</div></body></html>`
          ),
      })
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'http://example.com/',
          requirementsOf({
            Example: {
              text: ['shop'],
              css: ['\\.example-class'],
              scripts: ['window\\.example'],
              scriptSrc: ['example\\.js'],
              meta: { generator: 'Example' },
              dom: {
                '#example': {
                  exists: '',
                  text: 'Example',
                  attributes: { 'data-version': '' },
                },
              },
            },
          })
        )
        expect(observation.text).toEqual(['Example shop'])
        expect(observation.css).toEqual(['.example-class {}'])
        expect(observation.script).toEqual(['window.example = true'])
        expect(observation.scriptSrc).toEqual([
          'https://www.example.org/shop/example.js',
        ])
        expect(observation.meta).toEqual(
          new Map([['generator', ['Example 1.0']]])
        )
        expect(observation.domExists).toEqual(new Set(['#example']))
        expect(observation.domText).toEqual(
          new Map([['#example', ['Example shop']]])
        )
        expect(observation.domAttribute).toEqual(
          new Map([['#example', new Map([['data-version', ['1.0']]])]])
        )
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('fetches robots.txt only when the catalog has robots rules', () => {
    const { layer, requested } = site({
      'https://example.com/': () => new Response(''),
      'https://example.com/robots.txt': () => new Response('Disallow: /x/'),
    })
    return Effect.gen(function* () {
      const without = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { html: ['example'] } })
      )
      expect(without.robots).toEqual([])
      expect(requested).not.toContain('https://example.com/robots.txt')

      const observation = yield* Collector.collect(
        'https://example.com/shop/',
        requirementsOf({ Example: { robots: ['Disallow'] } })
      )
      expect(observation.robots).toEqual(['Disallow: /x/'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('leaves robots empty when robots.txt is missing', () => {
    const { layer } = site({
      'https://example.com/': () => new Response(''),
      'https://example.com/robots.txt': () =>
        new Response('Not found', { status: 404 }),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { robots: ['Not found'] } })
      )
      expect(observation.robots).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('probes the required paths and keeps the ones that exist', () => {
    const { layer, requested } = site({
      'https://example.com/': () => new Response(''),
      'https://example.com/version': () => new Response('Example 1.0'),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/shop/',
        requirementsOf({
          Example: { probe: { '/version': 'Example' } },
          Other: { probe: { '/other': '' } },
        })
      )
      expect(observation.probe).toEqual(
        new Map([['/version', ['Example 1.0']]])
      )
      expect(requested).toContain('https://example.com/other')
    }).pipe(Effect.provide(layer))
  })

  it.effect('observes no probes on a site that answers every path', () => {
    const { layer, requested } = site(
      {},
      { otherwise: () => new Response('<html>App</html>') }
    )
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { probe: { '/version': '' } } })
      )
      expect(observation.probe).toEqual(new Map())
      expect(requested).toContainEqual(
        expect.stringMatching(/^https:\/\/example\.com\/[\da-f-]{36}$/)
      )
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'keeps only the probes the site answers without redirecting',
    () => {
      const { layer } = site(
        {
          'https://example.com/': () => new Response('<html>Home</html>'),
          'https://example.com/version': () => new Response('Example 1.0'),
        },
        {
          otherwise: () =>
            new Response(null, {
              status: 302,
              headers: { location: 'https://example.com/' },
            }),
        }
      )
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({
            Example: { probe: { '/version': '' } },
            Other: { probe: { '/other': '' } },
          })
        )
        expect(observation.probe).toEqual(
          new Map([['/version', ['Example 1.0']]])
        )
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('observes no probes when the random path cannot be loaded', () => {
    const { layer } = site(
      {
        'https://example.com/': () => new Response(''),
        'https://example.com/version': () => new Response('Example 1.0'),
      },
      { otherwise: () => new Error('connection reset') }
    )
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { probe: { '/version': '' } } })
      )
      expect(observation.probe).toEqual(new Map())
    }).pipe(Effect.provide(layer))
  })

  it.effect('requests no random path when the catalog has no probes', () => {
    const { layer, requested } = site({
      'https://example.com/': () => new Response(''),
    })
    return Effect.gen(function* () {
      yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { html: ['example'] } })
      )
      expect(requested).toEqual(['https://example.com/'])
    }).pipe(Effect.provide(layer))
  })

  it.effect('probes paths at the root of the site', () => {
    const { layer, requested } = site({
      'https://example.com/': () => new Response(''),
    })
    return Effect.gen(function* () {
      yield* Collector.collect(
        'https://example.com/shop/',
        requirementsOf({
          Example: {
            probe: {
              version: '',
              '//other.example/a': '',
              '/\\other.example/b': '',
              '/\\[': '',
            },
          },
        })
      )
      expect(requested).toContain('https://example.com/version')
      expect(requested).toContainEqual(
        expect.stringMatching(/^https:\/\/example\.com\/[\da-f-]{36}$/)
      )
      expect(requested).toHaveLength(6)
      expect(
        requested.filter((url) => !url.startsWith('https://example.com/'))
      ).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'observes the certificate issuer only when the catalog has certIssuer rules',
    () => {
      const { layer, certificateRequests } = site(
        { 'https://example.com/': () => new Response('') },
        { issuers: { 'https://example.com': () => 'O=Example CA' } }
      )
      return Effect.gen(function* () {
        const without = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({ Example: { html: ['example'] } })
        )
        expect(without.certIssuer).toEqual([])
        expect(certificateRequests).toEqual([])

        const observation = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({ Example: { certIssuer: 'Example CA' } })
        )
        expect(observation.certIssuer).toEqual(['O=Example CA'])
        expect(certificateRequests).toEqual(['https://example.com/'])
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect(
    'looks up everything besides the page on the site it was redirected to',
    () => {
      const { layer, requested, resolved, certificateRequests } = site(
        {
          'http://example.com/': () =>
            new Response(null, {
              status: 301,
              headers: { location: 'https://www.example.org/' },
            }),
          'https://www.example.org/': () => new Response(''),
          'https://www.example.org/robots.txt': () =>
            new Response('Disallow: /x/'),
        },
        {
          records: { 'example.org': { MX: ['10 mx.example.org'] } },
          issuers: { 'https://www.example.org': () => 'O=Example CA' },
        }
      )
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'http://example.com/',
          requirementsOf({
            Example: {
              robots: ['Disallow'],
              probe: { '/version': '' },
              dns: { MX: ['example'], CNAME: ['cdn'] },
              certIssuer: 'Example CA',
            },
          })
        )
        expect(observation.robots).toEqual(['Disallow: /x/'])
        expect(observation.dns).toEqual(
          new Map([['MX', ['10 mx.example.org']]])
        )
        expect(observation.certIssuer).toEqual(['O=Example CA'])
        expect(requested).toHaveLength(5)
        expect(requested).toEqual(
          expect.arrayContaining([
            'http://example.com/',
            'https://www.example.org/',
            expect.stringMatching(
              /^https:\/\/www\.example\.org\/[\da-f-]{36}$/
            ),
            'https://www.example.org/robots.txt',
            'https://www.example.org/version',
          ])
        )
        expect(resolved.toSorted()).toEqual([
          'CNAME www.example.org',
          'MX example.org',
        ])
        expect(certificateRequests).toEqual(['https://www.example.org/'])
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('reads no certificate for a page served over plain http', () => {
    const { layer, certificateRequests } = site({
      'http://example.com/': () => new Response(''),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'http://example.com/',
        requirementsOf({ Example: { certIssuer: 'Example CA' } })
      )
      expect(observation.certIssuer).toEqual([])
      expect(certificateRequests).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('ignores failures of requests besides the page', () => {
    const { layer } = site({
      'https://example.com/': () => new Response('page'),
      'https://example.com/robots.txt': () => new Error('connection reset'),
      'https://example.com/version': () => new Error('connection reset'),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({
          Example: {
            robots: ['Disallow'],
            probe: { '/version': '' },
            certIssuer: 'Example',
          },
        })
      )
      expect(observation.html).toEqual(['page'])
      expect(observation.robots).toEqual([])
      expect(observation.probe).toEqual(new Map())
      expect(observation.certIssuer).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect(
    'reads the first 2 MiB of the page and of probes and 500 KiB of robots.txt',
    () => {
      const page = endless('a')
      const robots = endless('r')
      const probe = endless('p')
      const { layer } = site({
        'https://example.com/': page.response,
        'https://example.com/robots.txt': robots.response,
        'https://example.com/version': probe.response,
      })
      return Effect.gen(function* () {
        const observation = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({
            Example: { robots: ['r'], probe: { '/version': 'p' } },
          })
        )
        expect(observation.html).toEqual(['a'.repeat(2 * 1024 * 1024)])
        expect(observation.robots).toEqual(['r'.repeat(500 * 1024)])
        expect(observation.probe).toEqual(
          new Map([['/version', ['p'.repeat(2 * 1024 * 1024)]]])
        )
        expect(
          [page, robots, probe].map(({ stream }) => stream.cancelled)
        ).toEqual([true, true, true])
      }).pipe(Effect.provide(layer))
    }
  )

  it.effect('cuts the page at the limit in the middle of a character', () => {
    const { layer } = site({
      'https://example.com/': endless('aé').response,
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({})
      )
      expect(observation.html).toEqual([
        `${'aé'.repeat(Math.floor((2 * 1024 * 1024) / 3))}a\uFFFD`,
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect('keeps a probe that answers without a body', () => {
    const { layer } = site({
      'https://example.com/': () => new Response(null),
      'https://example.com/version': () => new Response(null, { status: 204 }),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { probe: { '/version': '' } } })
      )
      expect(observation.html).toEqual([''])
      expect(observation.probe).toEqual(new Map([['/version', ['']]]))
    }).pipe(Effect.provide(layer))
  })

  it.effect('resolves the dns records the catalog asks for', () => {
    const { layer, resolved } = site(
      { 'https://www.example.com/': () => new Response('') },
      {
        records: {
          'example.com': {
            MX: ['10 aspmx.l.google.com', '20 alt1.aspmx.l.google.com'],
            TXT: ['v=spf1 include:_spf.google.com ~all'],
          },
          'www.example.com': { CNAME: ['example.cdn.net'] },
        },
      }
    )
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://www.example.com/',
        requirementsOf({
          Mail: { dns: { MX: ['google\\.com'], TXT: ['_spf\\.google'] } },
          Cdn: { dns: { CNAME: ['cdn\\.net'] } },
          Hosting: { dns: { SOA: ['hosting\\.com'] } },
        })
      )
      expect(observation.dns).toEqual(
        new Map([
          ['MX', ['10 aspmx.l.google.com', '20 alt1.aspmx.l.google.com']],
          ['TXT', ['v=spf1 include:_spf.google.com ~all']],
          ['CNAME', ['example.cdn.net']],
        ])
      )
      expect(resolved.toSorted()).toEqual([
        'CNAME www.example.com',
        'MX example.com',
        'SOA example.com',
        'TXT example.com',
      ])
    }).pipe(Effect.provide(layer))
  })

  it.effect('resolves no dns records the catalog does not ask for', () => {
    const { layer, resolved } = site({
      'https://example.com/': () => new Response(''),
    })
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { html: ['example'] } })
      )
      expect(observation.dns).toEqual(new Map())
      expect(resolved).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('resolves no dns records for an ip address', () => {
    const { layer, resolved } = site({
      'http://127.0.0.1/': () => new Response(''),
      'http://[::1]/': () => new Response(''),
    })
    return Effect.gen(function* () {
      const requirements = requirementsOf({ Example: { dns: { NS: ['ns'] } } })
      yield* Collector.collect('http://127.0.0.1/', requirements)
      yield* Collector.collect('http://[::1]/', requirements)
      expect(resolved).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('ignores dns records that cannot be resolved', () => {
    const { layer } = site(
      { 'https://example.com/': () => new Response('page') },
      {
        records: {
          'example.com': {
            NS: new Error('queryNs ETIMEOUT example.com'),
            TXT: ['v=spf1'],
          },
        },
      }
    )
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { dns: { NS: ['ns'], TXT: ['spf'] } } })
      )
      expect(observation.html).toEqual(['page'])
      expect(observation.dns).toEqual(new Map([['TXT', ['v=spf1']]]))
    }).pipe(Effect.provide(layer))
  })

  it.effect.each<[string, Duration.Input | undefined, number]>([
    ['10 seconds by default', undefined, 10_000],
    ['the lookup timeout', '2 seconds', 2_000],
  ])(
    'leaves out lookups that take longer than %s',
    ([, lookupTimeout, millis]) =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        let pending = 4
        const hang = Effect.suspend(() => {
          pending -= 1
          if (pending === 0) Deferred.doneUnsafe(started, Effect.void)
          return Effect.never
        })
        const fiber = yield* Collector.collect(
          'https://example.com/',
          requirementsOf({
            Example: {
              robots: ['Disallow'],
              probe: { '/version': '' },
              dns: { TXT: ['spf'] },
              certIssuer: 'Example',
            },
          }),
          { lookupTimeout }
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Page.layerHttp,
              Layer.succeed(Certificate.Certificate, { issuer: () => hang }),
              Layer.succeed(Resolver.Resolver, { resolve: () => hang })
            ).pipe(
              Layer.provideMerge(
                Layer.succeed(
                  HttpClient.HttpClient,
                  HttpClient.make((request, url) =>
                    url.pathname === '/'
                      ? Effect.succeed(
                          HttpClientResponse.fromWeb(
                            request,
                            new Response('page')
                          )
                        )
                      : hang
                  )
                )
              )
            )
          ),
          Effect.forkChild
        )
        yield* Deferred.await(started)
        yield* TestClock.adjust(millis - 1)
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust('1 millis')
        const observation = yield* Fiber.join(fiber)
        expect(observation.html).toEqual(['page'])
        expect(observation.robots).toEqual([])
        expect(observation.probe).toEqual(new Map())
        expect(observation.dns).toEqual(new Map())
        expect(observation.certIssuer).toEqual([])
      })
  )

  it.effect('sends no tracing headers to the site', () => {
    const { layer, headers } = site({
      'https://example.com/': () => new Response(''),
    })
    return Effect.gen(function* () {
      yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { robots: ['Disallow'] } })
      )
      expect(headers).toHaveLength(2)
      for (const sent of headers) {
        expect(Object.keys(sent)).not.toContain('traceparent')
        expect(Object.keys(sent)).not.toContain('b3')
      }
    }).pipe(Effect.provide(layer))
  })

  it.effect('fails with a PageError when the page cannot be loaded', () => {
    const { layer } = site({
      'https://example.com/': () => new Error('getaddrinfo ENOTFOUND'),
    })
    return Effect.gen(function* () {
      const error = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({})
      ).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Page.PageError)
      expect(error.url).toBe('https://example.com/')
      expect(error.message).toBe('Could not load https://example.com/')
    }).pipe(Effect.provide(layer))
  })

  it.effect('fails with a PageError for an invalid url', () => {
    const { layer, requested } = site({})
    return Effect.gen(function* () {
      const error = yield* Collector.collect(
        'example.com',
        requirementsOf({})
      ).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Page.PageError)
      expect(error.url).toBe('example.com')
      expect(requested).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('loads the page through the Page service', () => {
    const { clientLayer, certificateLayer, resolverLayer } = site({})
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'https://example.com/',
        requirementsOf({ Example: { text: ['rendered'] } })
      )
      expect(observation.url).toEqual(['https://example.com/rendered'])
      expect(observation.html).toEqual(['<html>rendered</html>'])
      expect(observation.text).toEqual(['rendered'])
    }).pipe(
      Effect.provide(
        Layer.succeed(Page.Page, {
          load: () =>
            Effect.succeed({
              url: ['https://example.com/rendered'],
              header: new Map(),
              cookie: new Map(),
              html: ['<html>rendered</html>'],
            }),
        })
      ),
      Effect.provide(
        Layer.mergeAll(clientLayer, certificateLayer, resolverLayer)
      )
    )
  })
})

describe('Collector.detect', () => {
  it.effect('matches what it collected against the catalog', () => {
    const { layer } = site({
      'https://example.com/': () =>
        new Response('', { headers: { 'x-powered-by': 'Example/2.1' } }),
    })
    return Effect.gen(function* () {
      const detections = yield* Collector.detect(
        catalogOf({
          Example: {
            headers: { 'X-Powered-By': 'Example/([\\d.]+)\\;version:\\1' },
          },
          Other: { headers: { Server: 'Other' } },
        }),
        'https://example.com/'
      )
      expect(
        detections.map(({ technology, version }) => [technology.name, version])
      ).toEqual([['Example', '2.1']])
    }).pipe(Effect.provide(layer))
  })

  it.effect('detects a technology by its dns records', () => {
    const { layer } = site(
      { 'https://example.com/': () => new Response('') },
      { records: { 'example.com': { MX: ['10 mx.mail.example.net'] } } }
    )
    return Effect.gen(function* () {
      const detections = yield* Collector.detect(
        catalogOf({ Mail: { dns: { MX: ['\\.mail\\.example\\.net'] } } }),
        'https://example.com/'
      )
      expect(detections.map(({ technology }) => technology.name)).toEqual([
        'Mail',
      ])
    }).pipe(Effect.provide(layer))
  })
})

describe('Collector.layer', () => {
  it.live('sends every request like a browser', () =>
    Effect.gen(function* () {
      const received: Array<Record<string, unknown>> = []
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve((request, response) => {
            received.push(request.headers)
            response.end()
          })
        ),
        (server) => Effect.promise(server.close)
      )
      yield* Collector.collect(
        server.url,
        requirementsOf({ Example: { robots: ['Disallow'] } })
      )
      expect(received).toHaveLength(2)
      for (const headers of received) {
        expect(headers).toMatchObject({
          'user-agent': expect.stringMatching(/ Chrome\/\d+\.0\.0\.0 /),
          accept: expect.stringMatching(/^text\/html,/),
          'accept-language': 'en-US,en;q=0.9',
        })
      }
    }).pipe(Effect.provide(Collector.layer))
  )

  it.live('ignores probes the server answers after a redirect', () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve((request, response) => {
            if (request.url === '/' || request.url === '/version') {
              response.end(request.url)
            } else {
              response.writeHead(302, { location: '/' }).end()
            }
          })
        ),
        (server) => Effect.promise(server.close)
      )
      const observation = yield* Collector.collect(
        server.url,
        requirementsOf({
          Example: { probe: { '/version': '' } },
          Other: { probe: { '/other': '' } },
        })
      )
      expect(observation.probe).toEqual(new Map([['/version', ['/version']]]))
    }).pipe(Effect.provide(Collector.layer))
  )
})

describe('Collector.layerOptions', () => {
  it.live('merges the given headers over the defaults', () =>
    Effect.gen(function* () {
      const received: Array<Record<string, unknown>> = []
      const server = yield* Effect.acquireRelease(
        Effect.promise(() =>
          serve((request, response) => {
            received.push(request.headers)
            response.end()
          })
        ),
        (server) => Effect.promise(server.close)
      )
      yield* Collector.collect(server.url, requirementsOf({})).pipe(
        Effect.provide(
          Collector.layerOptions({
            headers: { 'User-Agent': 'openwapp', 'x-scan': '1' },
          })
        )
      )
      expect(received).toEqual([
        expect.objectContaining({
          'user-agent': 'openwapp',
          'x-scan': '1',
          'accept-language': 'en-US,en;q=0.9',
        }),
      ])
    })
  )

  it.effect('sends requests through the given fetch', () => {
    const requested: Array<string> = []
    return Effect.gen(function* () {
      const observation = yield* Collector.collect(
        'http://127.0.0.1/',
        requirementsOf({ Example: { robots: ['Disallow'] } })
      )
      expect(requested).toEqual([
        'http://127.0.0.1/',
        'http://127.0.0.1/robots.txt',
      ])
      expect(observation.html).toEqual(['page'])
      expect(observation.robots).toEqual(['robots'])
    }).pipe(
      Effect.provide(
        Collector.layerOptions({
          fetch: async (input) => {
            const { url } = new Request(input)
            requested.push(url)
            return new Response(url.endsWith('/robots.txt') ? 'robots' : 'page')
          },
        })
      )
    )
  })
})

describe('Collector.detectPromise', () => {
  it('detects technologies on a local server with the upstream fingerprints', async () => {
    const catalog = Catalog.decodeSync(fingerprints)
    const server = await serve((_, response) => {
      response.setHeader('server', 'nginx/1.25.3')
      response.setHeader('x-powered-by', 'PHP/8.3.0')
      response.end(
        `<html><head>
          <meta name="generator" content="WordPress 6.4.2">
          <script src="/wp-includes/js/jquery/jquery-3.7.1.min.js"></script>
        </head><body></body></html>`
      )
    })
    try {
      const detections = await Collector.detectPromise(catalog, server.url)
      expect(
        detections.map(
          ({ technology, version }) => `${technology.name} ${version}`
        )
      ).toEqual(
        expect.arrayContaining([
          'Nginx 1.25.3',
          'PHP 8.3.0',
          'WordPress 6.4.2',
          'jQuery 3.7.1',
        ])
      )
    } finally {
      await server.close()
    }
  })
})

describe('Collector.collectPromise', () => {
  it('rejects with a PageError when nothing listens', async () => {
    const server = await serve((_, response) => response.end())
    await server.close()
    await expect(
      Collector.collectPromise(server.url, requirementsOf({}))
    ).rejects.toBeInstanceOf(Page.PageError)
  })

  it('rejects with the reason of an aborted signal', async () => {
    const controller = new AbortController()
    const reason = new Error('Took too long')
    const server = await serve(() => controller.abort(reason))
    try {
      await expect(
        Collector.collectPromise(server.url, requirementsOf({}), {
          signal: controller.signal,
        })
      ).rejects.toBe(reason)
    } finally {
      await server.close()
    }
  })

  it('stops downloading a page that never ends', async () => {
    const chunk = 'a'.repeat(64 * 1024)
    let disconnect: () => void
    const disconnected = new Promise<void>((resolve) => (disconnect = resolve))
    const server = await serve((_, response) => {
      response.on('close', () => disconnect())
      const write = () => {
        while (response.write(chunk));
        if (!response.destroyed) response.once('drain', write)
      }
      write()
    })
    try {
      const observation = await Collector.collectPromise(
        server.url,
        requirementsOf({})
      )
      expect(observation.html[0]).toHaveLength(2 * 1024 * 1024)
      await disconnected
    } finally {
      await server.close()
    }
  })

  it('collects with the given headers', async () => {
    const received: Array<Record<string, unknown>> = []
    const server = await serve((request, response) => {
      received.push(request.headers)
      response.end('page')
    })
    try {
      const observation = await Collector.collectPromise(
        server.url,
        requirementsOf({}),
        { headers: { 'user-agent': 'openwapp' } }
      )
      expect(observation.html).toEqual(['page'])
      expect(received).toEqual([
        expect.objectContaining({ 'user-agent': 'openwapp' }),
      ])
    } finally {
      await server.close()
    }
  })
})
