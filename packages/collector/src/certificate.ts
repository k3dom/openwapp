import { isIP } from 'node:net'
import * as Tls from 'node:tls'

import { Context, Effect, Layer, Schema } from 'effect'

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
        Effect.callback<string, unknown>((resume) => {
          const host = url.hostname.replace(/^\[|\]$/g, '')
          const socket = Tls.connect({
            host,
            port: Number(url.port) || 443,
            servername: isIP(host) === 0 ? host : undefined,
            rejectUnauthorized: false,
          })
          socket.once('secureConnect', () => {
            const certificate = socket.getPeerX509Certificate()
            socket.destroy()
            resume(
              certificate
                ? Effect.succeed(certificate.issuer)
                : Effect.fail(new Error('No certificate was presented'))
            )
          })
          socket.once('error', (cause) => resume(Effect.fail(cause)))
          return Effect.sync(() => socket.destroy())
        }),
      (effect, url) =>
        Effect.mapError(
          effect,
          (cause) => new CertificateError({ url: url.href, cause })
        )
    ),
  })
)
