# cli

Reports which technologies websites are built with, from the command line.

## Install

```sh
npm install --global @openwapp/cli
```

The CLI runs on Node.js and installs an `openwapp` command.

## Fingerprints

The CLI ships without fingerprint data. Pass fingerprints in the
[webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
with `--fingerprints` or the `OPENWAPP_FINGERPRINTS` environment variable, as
either of:

- a directory of `technologies/*.json`, `categories.json` and `groups.json`,
  such as the `data` directory of `@openwapp/fingerprints` or the `src`
  directory of enthec/webappanalyzer
- a JSON file of `technologies`, `categories` and `groups`

```sh
npm install --global @openwapp/fingerprints
export OPENWAPP_FINGERPRINTS="$(npm root --global)/@openwapp/fingerprints/data"
```

## Usage

### Detect

`openwapp detect` visits one or more sites and lists the technologies found on
each, with their version and categories. A confidence below 100% is shown next
to the name. The `https://` of a url may be left out.

```console
$ openwapp detect wordpress.org
https://wordpress.org/
  Google Font API         Font scripts
  Google Tag Manager      Tag managers
  Gutenberg 24.1.0        WordPress plugins, Editors
  HSTS                    Security
  Let's Encrypt           SSL/TLS certificate authorities
  MySQL                   Databases
  Nginx                   Web servers, Reverse proxies
  Open Graph              Miscellaneous
  PHP                     Programming languages
  Priority Hints          Performance
  RSS                     Miscellaneous
  WordPress 7.2           CMS, Blogs
  WordPress Block Editor  Page builders
  WordPress Site Editor   Page builders
```

With `--json`, it prints one JSON object per site on its own line instead, shown
here formatted and with a single technology.

```json
{
  "url": "https://wordpress.org",
  "finalUrl": "https://wordpress.org/",
  "technologies": [
    {
      "name": "WordPress",
      "version": "7.2",
      "confidence": 100,
      "categories": ["CMS", "Blogs"],
      "website": "https://wordpress.org",
      "description": "WordPress is a free and open-source content management system written in PHP and paired with a MySQL or MariaDB database. Features include a plugin architecture and a template system.",
      "cpe": "cpe:2.3:a:wordpress:wordpress:*:*:*:*:*:*:*:*"
    }
  ]
}
```

`version`, `description` and `cpe` are left out when unknown. The lines suit
tools such as `jq`:

```sh
openwapp detect --json example.com example.org | jq -r '.technologies[].name'
```

Sites are scanned 5 at a time and printed as they finish. A site that cannot be
loaded is printed as `{ "url", "error" }` with `--json`. Every such site is
reported at the end, and the command then exits with status 1.

### Collect

`openwapp collect` prints what was observed on a site as JSON, without matching
it. It gathers only what the fingerprints can make use of, such as the headers,
html, scripts, meta tags, DNS records and certificate issuer.

```sh
openwapp collect example.com > observation.json
```

### Options

| flag                           | default                               |
| ------------------------------ | ------------------------------------- |
| `--fingerprints`, `-f`         | `$OPENWAPP_FINGERPRINTS`              |
| `--header`, `-H`               | Chrome on Windows, merged with yours  |
| `--dns-server`                 | the DNS servers of the system         |
| `--timeout`                    | 30 seconds to scan a site             |
| `--lookup-timeout`             | 10 seconds for each lookup besides it |
| `--json` (detect)              | prints text                           |
| `--concurrency`, `-c` (detect) | 5 sites at once                       |

`--header` takes `"name: value"` and `--dns-server` takes an address such as
`1.1.1.1`. Repeat them to pass several. `--timeout` covers the whole scan of a
site, while a lookup besides the page, such as `/robots.txt`, a DNS record or
the certificate, is skipped when it takes longer than `--lookup-timeout`.

```sh
openwapp detect example.com \
  -H 'user-agent: my-scanner/1.0' \
  --dns-server 1.1.1.1 \
  --timeout 10
```

`openwapp --help` lists every flag, and `--log-level debug` shows the lookups
that failed. `--completions bash|zsh|fish` prints a shell completion script.

## License

MIT. The CLI ships without fingerprint data. Install `@openwapp/fingerprints`
(GPL-3.0-only) or bring your own.
