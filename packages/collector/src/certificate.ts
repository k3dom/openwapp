import * as Tls from 'node:tls'

import { Context, Effect, Layer, Result, Schema } from 'effect'
import { NetAddress } from 'effect/net'

export class CertificateError extends Schema.TaggedError<CertificateError>(
  '@openwapp/collector/certificate/CertificateError'
)('CertificateError', {
  url: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not read the certificate of ${this.url}`
  }
}

export class Certificate extends Context.Service<
  Certificate,
  {
    readonly issuer: (url: URL) => Effect.Effect<string, CertificateError>
  }
>()('@openwapp/collector/certificate/Certificate') {}

export const layerNode = Layer.succeed(
  Certificate,
  Certificate.of({
    issuer: Effect.fn('Certificate.issuer')(
      (url) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            const host = url.hostname.replace(/^\[|\]$/g, '')
            return Tls.connect({
              host,
              port: Number(url.port) || 443,
              servername: Result.match(NetAddress.ipFromString(host), {
                onSuccess: () => undefined,
                onFailure: () => host,
              }),
              rejectUnauthorized: false,
            })
          }),
          (socket) =>
            Effect.callback<string, unknown>((resume) => {
              socket.once('secureConnect', () => {
                const certificate = socket.getPeerX509Certificate()
                resume(
                  certificate
                    ? Effect.succeed(certificate.issuer)
                    : Effect.fail(new Error('No certificate was presented'))
                )
              })
              socket.on('error', (cause) => resume(Effect.fail(cause)))
            }),
          (socket) => Effect.sync(() => socket.destroy())
        ),
      (effect, url) =>
        Effect.mapError(
          effect,
          (cause) => new CertificateError({ url: url.href, cause })
        )
    ),
  })
)
