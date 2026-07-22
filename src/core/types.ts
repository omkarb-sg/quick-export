/**
 * Shared types for the quick-export protocol between the browser extension and the
 * local host service, and for the host-child export contract.
 */

/** Identifies one Aras item to export, the way the SolutionUpgrade engine wants it. */
export interface ItemRef {
  itemType: string
  itemId: string
  keyedName: string
  /** PackageDefinition name the item belongs to. Required — unpackaged items are blocked (D-01). */
  package: string
}

/** Connection context the extension lends the service for one export (token forwarding). */
export interface ConnContext {
  /** Base instance URL, e.g. http://localhost/12sp9 */
  url: string
  database: string
  /** OAuth bearer token from the logged-in session. May include a leading "Bearer ". */
  token: string
}

export interface ExportOptions {
  /** Mirror native default (true). Include referenced items in the export. */
  exportReferenced?: boolean
}

/** Extension → service: export one item. */
export interface ExportRequest {
  reqId: string
  conn: ConnContext
  item: ItemRef
  options?: ExportOptions
}

/** Stable error codes so the extension can branch on failure kind. */
export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  AUTH: 'AUTH',
  FAULT: 'FAULT',
  NO_OUTPUT: 'NO_OUTPUT',
  SERVICE: 'SERVICE',
  UNPACKAGED: 'UNPACKAGED'
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** Service → extension: the result of an export. */
export interface ExportResult {
  reqId: string
  ok: boolean
  /** Present on success: the exported file name (e.g. CheckFavoriteOwner.xml). */
  filename?: string
  /** Present on success: the raw XML text (UTF-8, includes the BOM). */
  xml?: string
  /** Engine-reported error count (0 on a clean run). */
  engineErrors?: number
  /** Present on failure. */
  error?: string
  code?: ErrorCode
}

/** The grouped shape the host child (export.ps1 -GroupsJson) consumes. */
export type PackageGroups = Record<string, Array<{ itemType: string; itemId: string; keyedName: string }>>
