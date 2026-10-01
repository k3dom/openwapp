import { createSocket } from 'node:dgram'
import Dns from 'node:dns/promises'
import type { AddressInfo } from 'node:net'

import { describe, expect, it, layer } from '@effect/vitest'
import type { Rule } from '@openwapp/matcher'
import { Effect, Layer } from 'effect'

import * as Resolver from '#/resolver.ts'

const u8 = (value: number) => Buffer.from([value])
const u16 = (value: number) => {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value)
  return buffer
}
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}
const text = (value: string) =>
  Buffer.concat([u8(value.length), Buffer.from(value)])
const name = (value: string) =>
  Buffer.concat([...value.split('.').map(text), u8(0)])

const codes = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  NAPTR: 35,
  CAA: 257,
} satisfies Record<Rule.DnsRecordType, number>

const NXDOMAIN = 3
const SERVFAIL = 2

const zone: Record<string, ReadonlyArray<Buffer> | number> = {
  'A example.com': [Buffer.from([192, 0, 2, 1])],
  'AAAA example.com': [Buffer.from([0x20, 0x01, 0x0d, 0xb8, ...Array(11), 1])],
  'CAA example.com': [
    Buffer.concat([u8(0), text('issue'), Buffer.from('letsencrypt.org')]),
  ],
  'CNAME www.example.com': [name('example.cdn.net')],
  'MX example.com': [
    Buffer.concat([u16(10), name('aspmx.l.google.com')]),
    Buffer.concat([u16(20), name('alt1.aspmx.l.google.com')]),
  ],
  'NAPTR example.com': [
    Buffer.concat([
      u16(100),
      u16(10),
      text('S'),
      text('SIP+D2U'),
      text(''),
      name('_sip._udp.example.com'),
    ]),
  ],
  'NS example.com': [name('ns1.example.net'), name('ns2.example.net')],
  'PTR 1.2.0.192.in-addr.arpa': [name('example.com')],
  'SOA example.com': [
    Buffer.concat([
      name('ns1.example.net'),
      name('hostmaster.example.com'),
      u32(2024010101),
      u32(7200),
      u32(3600),
      u32(1209600),
      u32(300),
    ]),
  ],
  'SRV _sip._udp.example.com': [
    Buffer.concat([u16(10), u16(5), u16(5060), name('sip.example.com')]),
  ],
  'TXT example.com': [
    Buffer.concat([text('v=spf1 include:_spf.google.com'), text(' ~all')]),
    text('google-site-verification=abc'),
  ],
  'NS missing.example.com': NXDOMAIN,
  'NS broken.example.com': SERVFAIL,
}

const dnsServer = Effect.acquireRelease(
  Effect.promise(async () => {
    const socket = createSocket('udp4')
    socket.on('message', (query, remote) => {
      let end = 12
      const labels: Array<string> = []
      while (query[end] !== 0) {
        const length = query[end] ?? 0
        labels.push(query.toString('latin1', end + 1, end + 1 + length))
        end += length + 1
      }
      const code = query.readUInt16BE(end + 1)
      const type = Object.entries(codes).find(
        ([, value]) => value === code
      )?.[0]
      const found = zone[`${type} ${labels.join('.')}`] ?? []
      const answers = typeof found === 'number' ? [] : found
      socket.send(
        Buffer.concat([
          u16(query.readUInt16BE(0)),
          u16(0x8180 | (typeof found === 'number' ? found : 0)),
          u16(1),
          u16(answers.length),
          u16(0),
          u16(0),
          query.subarray(12, end + 5),
          ...answers.flatMap((data) => [
            u16(0xc00c),
            u16(code),
            u16(1),
            u32(60),
            u16(data.length),
            data,
          ]),
        ]),
        remote.port,
        remote.address
      )
    })
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
    return socket
  }),
  (socket) =>
    Effect.promise(
      () => new Promise<void>((resolve) => socket.close(() => resolve()))
    )
).pipe(
  Effect.map((socket) => `127.0.0.1:${(socket.address() as AddressInfo).port}`)
)

describe('Resolver.layerNode', () => {
  it.effect('resolves through the servers set with Dns.setServers', () =>
    Effect.gen(function* () {
      const server = yield* dnsServer
      const servers = Dns.getServers()
      yield* Effect.acquireRelease(
        Effect.sync(() => Dns.setServers([server])),
        () => Effect.sync(() => Dns.setServers(servers))
      )
      const resolver = yield* Resolver.Resolver
      expect(yield* resolver.resolve('example.com', 'A')).toEqual(['192.0.2.1'])
    }).pipe(Effect.provide(Resolver.layerNode))
  )
})

layer(
  Layer.unwrap(
    Effect.map(dnsServer, (server) =>
      Resolver.layerNodeOptions({ servers: [server] })
    )
  )
)('Resolver.layerNodeOptions', (it) => {
  it.effect.each<[Rule.DnsRecordType, string, ReadonlyArray<string>]>([
    ['A', 'example.com', ['192.0.2.1']],
    ['AAAA', 'example.com', ['2001:db8::1']],
    ['CAA', 'example.com', ['0 issue "letsencrypt.org"']],
    ['CNAME', 'www.example.com', ['example.cdn.net']],
    [
      'MX',
      'example.com',
      ['10 aspmx.l.google.com', '20 alt1.aspmx.l.google.com'],
    ],
    ['NAPTR', 'example.com', ['100 10 "S" "SIP+D2U" "" _sip._udp.example.com']],
    ['NS', 'example.com', ['ns1.example.net', 'ns2.example.net']],
    ['PTR', '1.2.0.192.in-addr.arpa', ['example.com']],
    [
      'SOA',
      'example.com',
      [
        'ns1.example.net hostmaster.example.com 2024010101 7200 3600 1209600 300',
      ],
    ],
    ['SRV', '_sip._udp.example.com', ['10 5 5060 sip.example.com']],
    [
      'TXT',
      'example.com',
      ['v=spf1 include:_spf.google.com ~all', 'google-site-verification=abc'],
    ],
  ])('resolves %s records as text', ([type, hostname, records]) =>
    Effect.gen(function* () {
      const resolver = yield* Resolver.Resolver
      expect(yield* resolver.resolve(hostname, type)).toEqual(records)
    })
  )

  it.effect('resolves no records when the name has none of the type', () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver.Resolver
      expect(yield* resolver.resolve('example.com', 'SRV')).toEqual([])
    })
  )

  it.effect('resolves no records when the name does not exist', () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver.Resolver
      expect(yield* resolver.resolve('missing.example.com', 'NS')).toEqual([])
    })
  )

  it.effect('fails with a ResolverError when the lookup fails', () =>
    Effect.gen(function* () {
      const resolver = yield* Resolver.Resolver
      const error = yield* resolver
        .resolve('broken.example.com', 'NS')
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Resolver.ResolverError)
      expect(error.hostname).toBe('broken.example.com')
      expect(error.type).toBe('NS')
      expect(error.message).toBe(
        'Could not resolve NS records of broken.example.com'
      )
    })
  )
})
