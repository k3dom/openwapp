import Dns from 'node:dns/promises'

import { Rule } from '@openwapp/matcher'
import { Context, Effect, Layer, Schema } from 'effect'

export class ResolverError extends Schema.TaggedError<ResolverError>(
  '@openwapp/collector/resolver/ResolverError'
)('ResolverError', {
  hostname: Schema.String,
  type: Rule.DnsRecordType,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not resolve ${this.type} records of ${this.hostname}`
  }
}

export class Resolver extends Context.Service<
  Resolver,
  {
    readonly resolve: (
      hostname: string,
      type: Rule.DnsRecordType
    ) => Effect.Effect<ReadonlyArray<string>, ResolverError>
  }
>()('@openwapp/collector/resolver/Resolver') {}

const lookups: {
  readonly [Type in Rule.DnsRecordType]: (
    resolver: Dns.Resolver,
    hostname: string
  ) => Promise<Array<string>>
} = {
  A: (resolver, hostname) => resolver.resolve4(hostname),
  AAAA: (resolver, hostname) => resolver.resolve6(hostname),
  CAA: async (resolver, hostname) =>
    (await resolver.resolveCaa(hostname)).map(({ critical, ...property }) =>
      [
        critical,
        ...Object.entries(property)
          .filter(([tag]) => tag !== 'type')
          .map(([tag, value]) => `${tag} "${value}"`),
      ].join(' ')
    ),
  CNAME: (resolver, hostname) => resolver.resolveCname(hostname),
  MX: async (resolver, hostname) =>
    (await resolver.resolveMx(hostname)).map(
      ({ priority, exchange }) => `${priority} ${exchange}`
    ),
  NAPTR: async (resolver, hostname) =>
    (await resolver.resolveNaptr(hostname)).map(
      ({ order, preference, flags, service, regexp, replacement }) =>
        `${order} ${preference} "${flags}" "${service}" "${regexp}" ${replacement}`
    ),
  NS: (resolver, hostname) => resolver.resolveNs(hostname),
  PTR: (resolver, hostname) => resolver.resolvePtr(hostname),
  SOA: async (resolver, hostname) => {
    const soa = await resolver.resolveSoa(hostname)
    return [
      [
        soa.nsname,
        soa.hostmaster,
        soa.serial,
        soa.refresh,
        soa.retry,
        soa.expire,
        soa.minttl,
      ].join(' '),
    ]
  },
  SRV: async (resolver, hostname) =>
    (await resolver.resolveSrv(hostname)).map(
      ({ priority, weight, port, name }) =>
        `${priority} ${weight} ${port} ${name}`
    ),
  TXT: async (resolver, hostname) =>
    (await resolver.resolveTxt(hostname)).map((chunks) => chunks.join('')),
}

export const layerNode: Layer.Layer<Resolver> = Layer.succeed(
  Resolver,
  Resolver.of({
    resolve: Effect.fn('Resolver.resolve')(function* (hostname, type) {
      return yield* Effect.tryPromise({
        try: (signal) => {
          const resolver = new Dns.Resolver()
          resolver.setServers(Dns.getServers())
          signal.addEventListener('abort', () => resolver.cancel())
          return lookups[type](resolver, hostname).catch((error: unknown) => {
            if (
              error instanceof Error &&
              'code' in error &&
              (error.code === Dns.NODATA || error.code === Dns.NOTFOUND)
            ) {
              return []
            }
            throw error
          })
        },
        catch: (cause) => new ResolverError({ hostname, type, cause }),
      })
    }),
  })
)
