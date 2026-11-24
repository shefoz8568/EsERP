import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { contactDto, itemDto } from '@eserp/shared';

export interface CsvPreview {
  rows: number;
  valid: number;
  errors: { row: number; message: string }[];
  preview: Record<string, unknown>[];
}

const CONTACT_COLUMNS = [
  'type', 'legalName', 'legalNameAr', 'displayName', 'taxNumber',
  'commercialRegistration', 'email', 'phone', 'street', 'city',
  'postalCode', 'country', 'creditLimitMinor', 'creditLimitCurrency',
  'paymentTermsDays', 'status', 'notes',
] as const;

const ITEM_COLUMNS = [
  'sku', 'name', 'nameAr', 'description', 'categoryId', 'defaultUomId',
  'taxRateId', 'barcode', 'costingMethod', 'standardCostMinor',
  'standardCostCurrency', 'salesPriceMinor', 'salesPriceCurrency',
  'purchasePriceMinor', 'purchasePriceCurrency', 'status', 'trackStock',
  'reorderPoint', 'minStock', 'maxStock', 'imageFileId',
] as const;

/**
 * CSV import preview (Phase 1): parse + validate server-side, report row
 * errors, never persist anything. Follows the onboarding CSV-import pattern
 * (csv-parse/sync, header row, row numbers start at 2). Callers may add an
 * import-commit endpoint later; Phase 1 ships preview only.
 */
@Injectable()
export class CsvImportService {
  previewContacts(csvText: string): CsvPreview {
    return this.preview(csvText, 'contacts');
  }

  previewItems(csvText: string): CsvPreview {
    return this.preview(csvText, 'items');
  }

  private preview(csvText: string, kind: 'contacts' | 'items'): CsvPreview {
    let records: Record<string, string>[];
    try {
      records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException(`CSV parse error: ${(err as Error).message}`);
    }
    const columns = kind === 'contacts' ? CONTACT_COLUMNS : ITEM_COLUMNS;
    const schema = kind === 'contacts' ? contactDto : itemDto;
    const errors: { row: number; message: string }[] = [];
    const preview: Record<string, unknown>[] = [];
    records.forEach((row, i) => {
      const rowNo = i + 2; // header is row 1
      const cleaned: Record<string, unknown> = {};
      for (const col of columns) {
        const raw = row[col];
        if (raw === undefined || raw === '') continue;
        cleaned[col] = raw;
      }
      // Numeric / boolean columns arrive as strings from CSV.
      for (const col of ['creditLimitMinor', 'paymentTermsDays', 'standardCostMinor', 'salesPriceMinor', 'purchasePriceMinor', 'reorderPoint', 'minStock', 'maxStock'] as const) {
        if (cleaned[col] !== undefined) {
          const n = Number(cleaned[col]);
          if (!Number.isInteger(n)) {
            errors.push({ row: rowNo, message: `${col} must be an integer, got "${cleaned[col]}"` });
            return;
          }
          cleaned[col] = n;
        }
      }
      if (cleaned.trackStock !== undefined) {
        const v = String(cleaned.trackStock).toLowerCase();
        if (v === 'true' || v === '1') cleaned.trackStock = true;
        else if (v === 'false' || v === '0') cleaned.trackStock = false;
        else {
          errors.push({ row: rowNo, message: `trackStock must be true/false, got "${cleaned.trackStock}"` });
          return;
        }
      }
      const result = schema.safeParse(cleaned);
      if (!result.success) {
        errors.push({ row: rowNo, message: result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
        return;
      }
      preview.push(result.data as Record<string, unknown>);
    });
    return { rows: records.length, valid: preview.length, errors, preview: preview.slice(0, 10) };
  }
}
