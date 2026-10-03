import type { Requirements } from '@openwapp/matcher'
import { compile } from 'css-select'
import type { AnyNode, Element } from 'domhandler'
import { findAll, getAttributeValue, innerText, textContent } from 'domutils'
import { Array, pipe, Record } from 'effect'
import { parseDocument } from 'htmlparser2'

export const extract = (
  html: string,
  url: string | URL,
  requirements: Requirements.Requirements
) => {
  const document = parseDocument(html)
  const all = findAll(() => true, document)
  const elements = (name: string) =>
    all.filter((element) => element.name === name)
  const scripts = elements('script')
  const href = elements('base')
    .map((base) => getAttributeValue(base, 'href'))
    .find((value) => value !== undefined)
  const base = URL.parse(href ?? '', url) ?? url
  const selected = new Map(
    [
      ...new Set([
        ...requirements.domExists,
        ...requirements.domText,
        ...requirements.domAttribute.keys(),
      ]),
    ].flatMap((selector) => {
      try {
        const found = all.filter(compile<AnyNode, Element>(selector))
        return Array.isArrayNonEmpty(found) ? [[selector, found] as const] : []
      } catch {
        return []
      }
    })
  )

  return {
    text: requirements.text
      ? [
          // Unlike the body's textContent that Wappalyzer reads, innerText
          // leaves out scripts and styles, so text rules such as `\bUPS\b`
          // cannot match JavaScript.
          innerText(elements('body')[0] ?? document.children)
            .replace(/\s+/g, ' ')
            .trim(),
        ]
      : [],
    css: requirements.css
      ? elements('style')
          .map(textContent)
          .filter((css) => css.trim() !== '')
      : [],
    script: requirements.script
      ? scripts.map(textContent).filter((script) => script.trim() !== '')
      : [],
    scriptSrc: requirements.scriptSrc
      ? scripts.flatMap((script) => {
          const src = getAttributeValue(script, 'src')?.trim()
          if (!src) return []
          const parsed = URL.parse(src, base)
          return parsed?.protocol === 'data:' ? [] : [parsed?.href ?? src]
        })
      : [],
    meta: new Map(
      pipe(
        elements('meta').flatMap((meta) => {
          const name = (
            getAttributeValue(meta, 'name') ||
            getAttributeValue(meta, 'property')
          )?.toLowerCase()
          const content = getAttributeValue(meta, 'content')
          return name && content && requirements.meta.has(name)
            ? [{ name, content }]
            : []
        }),
        Array.groupBy(({ name }) => name),
        Record.map(Array.map(({ content }) => content)),
        Record.toEntries
      )
    ),
    domExists: new Set(
      [...requirements.domExists].filter((selector) => selected.has(selector))
    ),
    domText: new Map(
      [...requirements.domText].flatMap((selector) => {
        const texts = (selected.get(selector) ?? [])
          .map((element) => textContent(element).trim())
          .filter((text) => text !== '')
        return Array.isArrayNonEmpty(texts) ? [[selector, texts] as const] : []
      })
    ),
    domAttribute: new Map(
      [...requirements.domAttribute].flatMap(([selector, attributes]) => {
        const found = selected.get(selector) ?? []
        const byAttribute = new Map(
          [...attributes].flatMap((attribute) => {
            const values = found.flatMap(
              (element) =>
                getAttributeValue(element, attribute.toLowerCase()) ?? []
            )
            return Array.isArrayNonEmpty(values)
              ? [[attribute, values] as const]
              : []
          })
        )
        return byAttribute.size > 0 ? [[selector, byAttribute] as const] : []
      })
    ),
  }
}
