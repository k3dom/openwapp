import type { ResolverOptions } from 'node:dns'
import Dns from 'node:dns/promises'

import { Rule } from '@openwapp/matcher'
import { Context, Effect, Layer, Predicate, Schema } from 'effect'

/**
 * The DNS records of a hostname could not be resolved. A hostname without
 * records of the type is not an error.
 */
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

/**
 * Resolves the DNS records of a hostname as strings, in the form rules match
 * them. `layerNode` resolves them with `node:dns`.
 */
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

/**
 * Options of `layerNodeOptions`, along with the `timeout`, `tries` and
 * `maxTimeout` of a `node:dns` resolver.
 */
export interface NodeOptions extends ResolverOptions {
  /**
   * Servers to query, in the format of `Dns.setServers`, such as `1.1.1.1` or
   * `[2606:4700:4700::1111]:53`. Defaults to the servers Node.js uses.
   */
  readonly servers?: ReadonlyArray<string>
}

/**
 * Resolves DNS records with `node:dns`, configured by the given options.
 *
 * @example
 * ```ts
 * import { Resolver } from '@openwapp/collector'
 *
 * const layer = Resolver.layerNodeOptions({ servers: ['1.1.1.1'], timeout: 2000 })
 * ```
 */
export const layerNodeOptions = ({ servers, ...options }: NodeOptions = {}) =>
  Layer.succeed(
    Resolver,
    Resolver.of({
      resolve: Effect.fn('Resolver.resolve')((hostname, type) =>
        Effect.tryPromise({
          try: (signal) => {
            // One resolver per lookup, since cancel aborts all of its queries.
            // A new resolver ignores servers set with Dns.setServers, so they
            // are copied.
            const resolver = new Dns.Resolver(options)
            resolver.setServers(servers ?? Dns.getServers())
            signal.addEventListener('abort', () => resolver.cancel())
            return lookups[type](resolver, hostname)
          },
          catch: (cause) => new ResolverError({ hostname, type, cause }),
        }).pipe(
          Effect.catchIf(
            ({ cause }) =>
              Predicate.hasProperty(cause, 'code') &&
              (cause.code === Dns.NODATA || cause.code === Dns.NOTFOUND),
            () => Effect.succeed([])
          )
        )
      ),
    })
  )

/**
 * Resolves DNS records with `node:dns` and the servers Node.js uses.
 */
export const layerNode = layerNodeOptions()
