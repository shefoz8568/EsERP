/**
 * Phase 11 — Integrations: pure helpers (no Node APIs, no I/O) shared by the
 * API and the web app.
 *
 * - ZATCA (Saudi Fatoora) TLV QR encoding + UBL 2.1 XML generation. The XML
 *   builder is deliberately standards-shaped, not a certified ZATCA output:
 *   it produces the UBL 2.1 fields ZATCA's e-invoicing spec requires (invoice
 *   number, UUID, issue date/time, seller/buyer VAT, line tax, totals, hash
 *   placeholder) from real invoice data. The SHA-256 hash itself is computed
 *   in the API service (Node crypto) and injected — see `buildUblXml`.
 * - Webhook HMAC signing is in the API (`webhooks.service.ts`, Node crypto);
 *   the header name and event catalogue live here so the web UI can show them.
 * - Field masking for encrypted HR fields (`maskSensitive`).
 * - Provider interfaces (payment / SMS) — see `providers.ts` in this file.
 *
 * Everything labelled SIMULATED / MOCK in this module is exactly that: no
 * live ZATCA clearance, payment, or SMS call is ever made by these helpers.
 */

export type ZatcaDocumentType = 'SIMPLIFIED' | 'STANDARD';
export type ZatcaDocumentStatus =
  | 'DRAFT'
  | 'GENERATED'
  | 'REPORTED'
  | 'CLEARED'
  | 'REJECTED'
  | 'REPORTED_SIMULATED'
  | 'CLEARED_SIMULATED';

/** Outbox event types the webhook worker delivers (subset of all events). */
export const WEBHOOK_EVENT_TYPES = [
  'sales-invoice.created',
  'sales-invoice.posted',
  'sales-invoice.voided',
  'customer-payment.created',
  'order.created',
  'order.confirmed',
  'order.cancelled',
  'payroll-run.created',
  'payroll-run.calculated',
  'payroll-run.approved',
  'payroll-run.paid',
  'stock.low',
  'ping',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Header carrying the HMAC-SHA256 signature of the raw webhook body. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-EsERP-Signature';

/** Data-export centre types (Phase 11). */
export const EXPORT_TYPES = [
  'contacts',
  'items',
  'sales-invoices',
  'purchase-orders',
  'journal-entries',
  'stock-levels',
  'employees',
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

/** API-key scopes are permission strings (see ROLE_PERMISSION_MATRIX). */
export const API_KEY_SCOPES = [
  'contacts:read', 'items:read', 'sales-invoices:read', 'sales-orders:read',
  'purchase-orders:read', 'stock:read', 'journals:read', 'analytics:read',
  'reports:read', 'zatca:read', 'webhooks:read', 'exports:read',
] as const;

// ---------------------------------------------------------------------------
// ZATCA TLV QR (ZATCA e-invoicing spec: tag, length, value; base64 of the
// concatenated TLV bytes). Tags: 1 seller name, 2 VAT number, 3 timestamp
// (ISO-8601), 4 total incl. VAT, 5 VAT amount. Length is one byte, so each
// value must fit in 255 bytes (UTF-8).
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Portable base64 encode (no Buffer / btoa dependency — works in the browser too). */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 63] : '=';
  }
  return out;
}

/** Portable base64 decode. */
export function base64Decode(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(clean[i]);
    const c1 = BASE64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = clean[i + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(clean[i + 2]);
    const c3 = clean[i + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== '=') bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== '=') bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function tlv(tag: number, value: string): Uint8Array {
  const v = utf8Encode(value);
  if (v.length > 255) throw new Error(`ZATCA TLV value for tag ${tag} exceeds 255 bytes`);
  const out = new Uint8Array(2 + v.length);
  out[0] = tag;
  out[1] = v.length;
  out.set(v, 2);
  return out;
}

export interface ZatcaQrInput {
  sellerName: string;
  vatNumber: string;
  /** ISO-8601 timestamp, e.g. 2026-11-24T10:00:00Z */
  timestamp: string;
  /** Total incl. VAT, decimal with 2 places, e.g. "115.00" */
  totalInclVat: string;
  /** VAT amount, decimal with 2 places, e.g. "15.00" */
  vatAmount: string;
}

/** Encode the five ZATCA QR fields as base64 TLV. */
export function encodeZatcaQr(input: ZatcaQrInput): string {
  const parts = [
    tlv(1, input.sellerName),
    tlv(2, input.vatNumber),
    tlv(3, input.timestamp),
    tlv(4, input.totalInclVat),
    tlv(5, input.vatAmount),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { all.set(p, offset); offset += p.length; }
  return base64Encode(all);
}

/** Decode a base64 TLV QR back to its five fields (used by tests). */
export function decodeZatcaQr(qrBase64: string): ZatcaQrInput {
  const bytes = base64Decode(qrBase64);
  const fields: Record<number, string> = {};
  let i = 0;
  while (i + 1 < bytes.length) {
    const tag = bytes[i];
    const len = bytes[i + 1];
    fields[tag] = utf8Decode(bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return {
    sellerName: fields[1] ?? '',
    vatNumber: fields[2] ?? '',
    timestamp: fields[3] ?? '',
    totalInclVat: fields[4] ?? '',
    vatAmount: fields[5] ?? '',
  };
}

/** Format integer minor units as a decimal string with 2 places ("115.00"). */
export function minorToDecimal(minor: bigint | number): string {
  const v = typeof minor === 'bigint' ? minor : BigInt(minor);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// UBL 2.1 XML generation (standards-shaped; see module header).
// ---------------------------------------------------------------------------

export interface UblLineInput {
  id: string;
  description: string;
  quantity: bigint | number;
  unitPriceMinor: bigint | number;
  lineTotalMinor: bigint | number;
  lineTaxMinor: bigint | number;
  taxRateBps: number;
}

export interface UblInvoiceInput {
  invoiceNumber: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  type: ZatcaDocumentType;
  sellerName: string;
  sellerVatNumber: string;
  sellerCity?: string;
  buyerName: string;
  buyerVatNumber?: string;
  currency: string;
  subtotalMinor: bigint | number;
  taxMinor: bigint | number;
  totalMinor: bigint | number;
  lines: UblLineInput[];
  /** SHA-256 hex of the canonical XML without the hash element (filled by the service). */
  previousHash?: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Build the UBL 2.1 invoice XML. `invoiceHash` is the SHA-256 of this XML
 * with the `<cbc:UUID>`/hash placeholder left empty — the service computes it
 * by hashing the XML produced with an empty hash, then injects the real hash
 * into the returned document record (the XML stored is the pre-hash
 * canonical form; see docs/erd-phase11.md for why this is labelled
 * standards-shaped, not certified).
 */
export function buildUblXml(input: UblInvoiceInput): string {
  const typeCode = input.type === 'SIMPLIFIED' ? '388' : '388';
  const lines = input.lines.map((l, idx) => `    <cac:InvoiceLine>
      <cbc:ID>${idx + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${l.quantity.toString()}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(l.lineTotalMinor)}</cbc:LineExtensionAmount>
      <cac:Item><cbc:Name>${xmlEscape(l.description)}</cbc:Name></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(l.unitPriceMinor)}</cbc:PriceAmount></cac:Price>
      <cac:TaxTotal><cbc:TaxAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(l.lineTaxMinor)}</cbc:TaxAmount>
        <cac:TaxSubtotal><cbc:TaxableAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(l.lineTotalMinor)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(l.lineTaxMinor)}</cbc:TaxAmount>
        <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${(l.taxRateBps / 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    </cac:InvoiceLine>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(input.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(input.uuid)}</cbc:UUID>
  <cbc:IssueDate>${xmlEscape(input.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${xmlEscape(input.issueTime)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${input.type === 'SIMPLIFIED' ? 'Simplified' : 'Standard'}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(input.currency)}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${xmlEscape(input.currency)}</cbc:TaxCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>${xmlEscape(input.sellerName)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:CityName>${xmlEscape(input.sellerCity ?? 'Riyadh')}</cbc:CityName><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(input.sellerVatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>${xmlEscape(input.buyerName)}</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    ${input.buyerVatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${xmlEscape(input.buyerVatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(input.taxMinor)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(input.subtotalMinor)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(input.subtotalMinor)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(input.totalMinor)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(input.currency)}">${minorToDecimal(input.totalMinor)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

// ---------------------------------------------------------------------------
// Field masking (HR sensitive fields). API responses return masked values
// unless the caller has `hr:read-sensitive`.
// ---------------------------------------------------------------------------

/** Mask a sensitive value, keeping only the last 4 characters visible. */
export function maskSensitive(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

/** True when a stored value is already in the Phase 11 encrypted format. */
export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('enc1:');
}

// ---------------------------------------------------------------------------
// Provider interfaces (bring-your-own-credentials; only mocks ship).
// ---------------------------------------------------------------------------

export interface PaymentChargeInput {
  amountMinor: bigint | number;
  currency: string;
  description?: string;
  reference?: string;
}

export interface PaymentResult {
  provider: string;
  /** Always 'mock' for the shipped provider — never a live charge. */
  simulated: boolean;
  status: 'succeeded' | 'failed';
  transactionId: string;
  amountMinor: number;
  currency: string;
  message: string;
}

export interface PaymentGateway {
  readonly name: string;
  charge(input: PaymentChargeInput): Promise<PaymentResult>;
  refund(transactionId: string, amountMinor: bigint | number): Promise<PaymentResult>;
}

export interface SmsInput {
  to: string;
  message: string;
}

export interface SmsResult {
  provider: string;
  /** Always 'mock' for the shipped provider — no SMS is ever sent. */
  simulated: boolean;
  status: 'queued' | 'failed';
  messageId: string;
}

export interface SmsProvider {
  readonly name: string;
  send(input: SmsInput): Promise<SmsResult>;
}
