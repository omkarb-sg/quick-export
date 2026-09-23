/**
 * Live-Aras: every kind of packaged item exports, not just "normal" items. For each ItemType
 * below, discovers one packaged element on the configured instance and exports it through the
 * real runner exactly as the extension requests it (element type, open item id, and the
 * PackageElement name — the file name a native export writes). Types the instance has no
 * packaged element of are skipped. Skips itself when unconfigured / off-Windows.
 *
 * Run with: npm run test:live
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { canRunLive, loadLiveConfig, type LiveConfig } from '../helpers/env.js'
import { applyAml, prop, propAttr, resultItems } from '../helpers/aml.js'
import { mintToken } from '../../src/aras/oauth.js'
import { runExport } from '../../src/service/runner.js'

const cfg = loadLiveConfig()
const suite = canRunLive() && cfg ? describe : describe.skip

const TYPES = [
  'Form',
  'Life Cycle Map',
  'Workflow Map',
  'ItemType',
  'RelationshipType',
  'List',
  'Method',
  'Action',
  'Report',
  'Permission',
  'Identity',
  'Sequence',
  'Variable'
]

interface Element {
  elementType: string
  elementId: string
  name: string
  packageName: string
}

async function findElement(config: LiveConfig, token: string, type: string): Promise<Element | null> {
  const { url, database } = config.primary
  const peXml = await applyAml(
    url,
    database,
    token,
    `<AML><Item type='PackageElement' action='get' select='element_type,element_id,name,source_id' maxRecords='1'>` +
      `<element_type>${type}</element_type></Item></AML>`
  )
  const pe = resultItems(peXml)[0]
  if (!pe) return null
  const grpXml = await applyAml(
    url,
    database,
    token,
    `<AML><Item type='PackageGroup' action='get' select='source_id' id='${prop(pe, 'source_id')}'/></AML>`
  )
  const grp = resultItems(grpXml)[0]
  if (!grp) return null
  return {
    elementType: prop(pe, 'element_type'),
    elementId: prop(pe, 'element_id'),
    name: prop(pe, 'name'),
    packageName: propAttr(grp, 'source_id', 'keyed_name')
  }
}

suite('live export of every packaged item kind', () => {
  let config: LiveConfig
  let token: string

  beforeAll(async () => {
    config = cfg!
    const tok = await mintToken(config.primary)
    token = `${tok.tokenType} ${tok.accessToken}`
  })

  it.for(TYPES)('exports a packaged %s', async (type, ctx) => {
    const el = await findElement(config, token, type)
    if (!el) return ctx.skip()
    const res = await runExport({
      reqId: `kind-${type}`,
      conn: { url: config.primary.url, database: config.primary.database, token },
      item: { itemType: el.elementType, itemId: el.elementId, keyedName: el.name, package: el.packageName },
      options: { exportReferenced: true }
    })
    expect(res.ok, `${type} ${el.name}: ${res.error}`).toBe(true)
    expect(res.engineErrors).toBe(0)
    // Named after the element, or after its id when the name is not a legal file name.
    expect([`${el.name}.xml`, `${el.elementId}.xml`]).toContain(res.filename)
    expect(res.xml!.startsWith('﻿<AML>')).toBe(true)
    expect(res.xml).toContain(`<Item type="${el.elementType}" id="${el.elementId}"`)
  })
})
