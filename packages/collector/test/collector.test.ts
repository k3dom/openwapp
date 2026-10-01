import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import {
  Catalog,
  Observation,
  Requirements,
  type Rule,
} from '@openwapp/matcher'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import {
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from 'effect/unstable/http'

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
  }: {
    readonly records?: Record<
      string,
      Partial<Record<Rule.DnsRecordType, ReadonlyArray<string> | Error>>
    >
    readonly issuers?: Record<string, () => string | Error>
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
    const response = routes[url.href]?.() ?? new Response(null, { status: 404 })
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
      expect(requested).toHaveLength(5)
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
        expect(requested.toSorted()).toEqual([
          'http://example.com/',
          'https://www.example.org/',
          'https://www.example.org/robots.txt',
          'https://www.example.org/version',
        ])
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

  it.effect('leaves out lookups that take longer than 10 seconds', () =>
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
        })
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
      yield* TestClock.adjust('10 seconds')
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
        requirementsOf({})
      )
      expect(observation.url).toEqual(['https://example.com/rendered'])
      expect(observation.html).toEqual(['<html>rendered</html>'])
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

describe('Collector.detectPromise', () => {
  it('detects technologies on a local server with the upstream fingerprints', async () => {
    const resolve = createRequire(import.meta.url).resolve
    const read = (path: string): Record<string, unknown> =>
      JSON.parse(
        readFileSync(resolve(`@openwapp/fingerprints/${path}`), 'utf8')
      )
    const catalog = Catalog.decodeSync({
      technologies: Object.assign(
        {},
        ...readdirSync(
          dirname(resolve('@openwapp/fingerprints/technologies/a.json'))
        ).map((file) => read(join('technologies', file)))
      ),
      categories: read('categories.json'),
      groups: read('groups.json'),
    })
    const server = await serve((_, response) => {
      response.setHeader('server', 'nginx/1.25.3')
      response.setHeader('x-powered-by', 'PHP/8.3.0')
      response.end('<html></html>')
    })
    try {
      const detections = await Collector.detectPromise(catalog, server.url)
      expect(
        detections.map(
          ({ technology, version }) => `${technology.name} ${version}`
        )
      ).toEqual(expect.arrayContaining(['Nginx 1.25.3', 'PHP 8.3.0']))
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
    const server = await serve(() => {})
    const controller = new AbortController()
    const reason = new Error('Took too long')
    setTimeout(() => controller.abort(reason), 50)
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
})
