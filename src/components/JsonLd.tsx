/**
 * Emits structured data as `application/ld+json`.
 *
 * ## Why `dangerouslySetInnerHTML`
 *
 * It is the only way to get raw JSON into a script tag. React escapes text children into
 * HTML entities, which produces `&quot;` where a parser needs `"` - the payload becomes
 * invalid JSON and every crawler silently ignores it. Next's own documentation uses this
 * exact pattern for JSON-LD.
 *
 * ## Why an HTML sanitizer is the wrong tool here
 *
 * DOMPurify sanitises HTML. This is JSON inside a `type="application/ld+json"` block, which
 * the browser never parses as HTML and never executes - it is inert data. Running it
 * through an HTML sanitizer would corrupt valid JSON (mangling quotes and unicode escapes)
 * while defending against a vector that does not exist in this context.
 *
 * ## What actually protects this
 *
 * 1. `JSON.stringify`, not string concatenation, so structure cannot be broken by a value.
 * 2. Escaping `<`. The one genuine breakout is a `</script>` sequence inside a string,
 *    which would close the tag early and make everything after it live markup. `<` is
 *    valid JSON, parses back to `<`, and cannot terminate the element.
 * 3. Provenance: every value comes from compiled-in content or server config. No request
 *    data, no database field, nothing a visitor can influence, reaches this component.
 *
 * Point 3 is the one to re-check if this is ever reused. If a value here ever becomes
 * user-supplied - a name, a review, a shared label - the `<` escape still holds the tag
 * closed, but validate the input at its source rather than relying on this alone.
 */
export default function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[]
}) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')

  return <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: json }} />
}
