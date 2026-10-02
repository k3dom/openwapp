import { Catalog } from '@openwapp/matcher'
import { Effect, FileSystem, Path } from 'effect'
import { CliError } from 'effect/cli'

export const load = Effect.fn('Fingerprints.load')(
  function* (path: string) {
    const fs = yield* FileSystem.FileSystem
    const { join } = yield* Path.Path
    const readJson = (file: string) =>
      fs.readFileString(file).pipe(
        Effect.flatMap((text) =>
          Effect.try({
            try: () => JSON.parse(text) as unknown,
            catch: (cause) => new Error(`${file} is not valid JSON`, { cause }),
          })
        )
      )

    const { type } = yield* fs.stat(path)
    const fingerprints =
      type === 'Directory'
        ? yield* Effect.all(
            {
              technologies: fs.readDirectory(join(path, 'technologies')).pipe(
                Effect.flatMap((files) =>
                  Effect.forEach(
                    files.filter((file) => file.endsWith('.json')).toSorted(),
                    (file) => readJson(join(path, 'technologies', file)),
                    { concurrency: 'unbounded' }
                  )
                ),
                Effect.map((parts) => Object.assign({}, ...parts) as unknown)
              ),
              categories: readJson(join(path, 'categories.json')),
              groups: readJson(join(path, 'groups.json')),
            },
            { concurrency: 'unbounded' }
          )
        : yield* readJson(path)
    return yield* Catalog.decode(fingerprints)
  },
  (effect, path) =>
    Effect.mapError(
      effect,
      (cause) =>
        new CliError.UserError({
          cause,
          userMessage: `Could not load the fingerprints from ${path}\n${cause.message}`,
        })
    )
)
