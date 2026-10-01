import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { type AddressInfo, createServer as createTcpServer } from 'node:net'
import { join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'

import * as Certificate from '#/certificate.ts'

// Regenerate the fixtures from within test/fixtures with:
// openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
//   -days 36500 -subj '/C=US/O=Example CA/CN=Example Issuer' \
//   -addext subjectAltName=DNS:localhost,IP:127.0.0.1 \
//   -keyout key.pem -out certificate.pem
const secureServer = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = createServer(
      {
        cert: readFileSync(
          join(import.meta.dirname, 'fixtures/certificate.pem')
        ),
        key: readFileSync(join(import.meta.dirname, 'fixtures/key.pem')),
      },
      (_, response) => response.end()
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server
  }),
  (server) =>
    Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
).pipe(
  Effect.map(
    (server) =>
      new URL(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  )
)

describe('Certificate.layerNode', () => {
  it.effect('reads the issuer of the certificate a site presents', () =>
    Effect.gen(function* () {
      const url = yield* secureServer
      const certificate = yield* Certificate.Certificate
      const issuer = yield* certificate.issuer(url)
      expect(issuer).toBe('C=US\nO=Example CA\nCN=Example Issuer')
    }).pipe(Effect.provide(Certificate.layerNode))
  )

  it.effect('fails with a CertificateError when nothing listens', () =>
    Effect.gen(function* () {
      const url = yield* Effect.scoped(secureServer)
      const certificate = yield* Certificate.Certificate
      const error = yield* certificate.issuer(url).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Certificate.CertificateError)
      expect(error.url).toBe(url.href)
    }).pipe(Effect.provide(Certificate.layerNode))
  )

  it.effect('closes the connection when interrupted', () =>
    Effect.gen(function* () {
      const accepted = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const server = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const server = createTcpServer((socket) => {
            socket.once('close', () => Deferred.doneUnsafe(closed, Effect.void))
            Deferred.doneUnsafe(accepted, Effect.void)
          })
          await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
          )
          return server
        }),
        (server) =>
          Effect.promise(() => new Promise((resolve) => server.close(resolve)))
      )
      const certificate = yield* Certificate.Certificate
      const fiber = yield* certificate
        .issuer(
          new URL(
            `https://127.0.0.1:${(server.address() as AddressInfo).port}/`
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(accepted)
      yield* Fiber.interrupt(fiber)
      yield* Deferred.await(closed)
    }).pipe(Effect.provide(Certificate.layerNode))
  )
})
