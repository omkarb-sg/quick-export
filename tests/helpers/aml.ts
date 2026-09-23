/**
 * Minimal AML-over-HTTP client for live tests: posts ApplyAML to InnovatorServer.aspx with a
 * bearer token and pulls flat property values out of the response with regexes (results are
 * requested flat — no nested `select` — so a regex per property is unambiguous).
 */

export async function applyAml(url: string, database: string, token: string, aml: string): Promise<string> {
  const body =
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>' +
    `<ApplyAML>${aml}</ApplyAML></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  const res = await fetch(url.replace(/\/+$/, '') + '/Server/InnovatorServer.aspx', {
    method: 'POST',
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      SOAPAction: 'ApplyAML',
      DATABASE: database,
      Authorization: token
    },
    body
  })
  return res.text()
}

/** Each `<Item ...>...</Item>` of a flat result, as raw XML. */
export function resultItems(xml: string): string[] {
  return xml.match(/<Item\b[^>]*>[\s\S]*?<\/Item>/g) ?? []
}

/** A flat property's text (XML-unescaped), or ''. */
export function prop(itemXml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(itemXml)
  return m ? unescapeXml(m[1]!) : ''
}

/** A property element's attribute (e.g. keyed_name on an item-reference property), or ''. */
export function propAttr(itemXml: string, name: string, attr: string): string {
  const m = new RegExp(`<${name}\\s[^>]*\\b${attr}="([^"]*)"`).exec(itemXml)
  return m ? unescapeXml(m[1]!) : ''
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
