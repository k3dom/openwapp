import { Effect, Stream } from 'effect'
import type { HttpClientError, HttpClientResponse } from 'effect/http'

export const bytes = (
  response: HttpClientResponse.HttpClientResponse,
  limit = 2 * 1024 * 1024
): Effect.Effect<Uint8Array, HttpClientError.HttpClientError> =>
  Stream.suspend(() => {
    let read = 0
    return response.stream.pipe(
      Stream.catchReason(
        'HttpClientError',
        'EmptyBodyError',
        () => Stream.empty
      ),
      Stream.map((chunk) => {
        const kept = chunk.subarray(0, limit - read)
        read += kept.length
        return kept
      }),
      Stream.takeUntil(() => read >= limit)
    )
  }).pipe(
    Stream.runCollect,
    Effect.map((chunks) => {
      const body = new Uint8Array(
        chunks.reduce((length, chunk) => length + chunk.length, 0)
      )
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
      return body
    })
  )

export const text = (
  response: HttpClientResponse.HttpClientResponse,
  limit?: number
) =>
  Effect.map(bytes(response, limit), (body) => new TextDecoder().decode(body))
