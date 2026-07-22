/**
 * Pure validation for the export request the extension sends the service. Keeping this
 * separate and pure makes it trivially unit-testable and lets the HTTP layer stay thin.
 */
import type { ExportRequest, ItemRef, ConnContext } from './types.js'
import { ErrorCode } from './types.js'

export interface ValidationOk {
  ok: true
  value: ExportRequest
}
export interface ValidationErr {
  ok: false
  error: string
  code: typeof ErrorCode.BAD_REQUEST | typeof ErrorCode.UNPACKAGED
}
export type ValidationResult = ValidationOk | ValidationErr

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function err(error: string, code: ValidationErr['code'] = ErrorCode.BAD_REQUEST): ValidationErr {
  return { ok: false, error, code }
}

/**
 * Validate and normalize an incoming export request. Returns a discriminated result so the
 * caller never throws on bad input. Unpackaged items (no `item.package`) are rejected with
 * the UNPACKAGED code — the extension turns that into the "add to package" offer (D-01).
 */
export function validateExportRequest(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) return err('request must be a JSON object')
  const r = input as Record<string, unknown>

  if (!isNonEmptyString(r.reqId)) return err('reqId is required')

  const conn = r.conn as Record<string, unknown> | undefined
  if (typeof conn !== 'object' || conn === null) return err('conn is required')
  if (!isNonEmptyString(conn.url)) return err('conn.url is required')
  if (!isNonEmptyString(conn.database)) return err('conn.database is required')
  if (!isNonEmptyString(conn.token)) return err('conn.token is required')

  const item = r.item as Record<string, unknown> | undefined
  if (typeof item !== 'object' || item === null) return err('item is required')
  if (!isNonEmptyString(item.itemType)) return err('item.itemType is required')
  if (!isNonEmptyString(item.itemId)) return err('item.itemId is required')
  if (!isNonEmptyString(item.keyedName)) return err('item.keyedName is required')
  if (!isNonEmptyString(item.package)) {
    return err('item.package is required — unpackaged items cannot be exported', ErrorCode.UNPACKAGED)
  }

  const options = (r.options as Record<string, unknown> | undefined) ?? {}
  const exportReferenced = options.exportReferenced
  if (exportReferenced !== undefined && typeof exportReferenced !== 'boolean') {
    return err('options.exportReferenced must be a boolean')
  }

  const value: ExportRequest = {
    reqId: (r.reqId as string).trim(),
    conn: {
      url: (conn.url as string).trim(),
      database: (conn.database as string).trim(),
      token: (conn.token as string).trim()
    } satisfies ConnContext,
    item: {
      itemType: (item.itemType as string).trim(),
      itemId: (item.itemId as string).trim(),
      keyedName: (item.keyedName as string).trim(),
      package: (item.package as string).trim()
    } satisfies ItemRef,
    options: { exportReferenced: exportReferenced === undefined ? true : exportReferenced }
  }
  return { ok: true, value }
}
