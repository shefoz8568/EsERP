/**
 * Phase 11 — encrypt existing Employee national ID / IBAN values in place.
 *
 * Run after migration 0013_phase11_integrations, with the same key the API
 * uses:
 *
 *   ENCRYPTION_KEY="<64 hex chars>" \
 *   DATABASE_URL="postgresql://eserp:<owner-password>@localhost:5432/eserp?schema=public" \
 *   npx tsx prisma/scripts/encrypt-employee-fields.ts
 *
 * Idempotent: values already in `enc1:` form are skipped, as are NULL/empty
 * values. Rows are updated one tenant at a time inside a transaction with
 * the bootstrap RLS context (this is a server-side maintenance script, not
 * a user request). Prints a count of rows encrypted / skipped.
 *
 * The key must be the SAME value the API runs with (ENCRYPTION_KEY) —
 * encrypting with a different key makes the values undecryptable.
 */
import { prisma, withBootstrap, FieldEncryptor, isEncryptedValue } from '../../src/index.js';

async function main(): Promise<void> {
  const encryptor = new FieldEncryptor();
  if (!encryptor.hasKey) {
    console.error('ENCRYPTION_KEY is not set (64 hex chars). Refusing to encrypt with no key.');
    process.exit(1);
  }
  type EmployeeRow = { id: string; nationalId: string | null; iban: string | null };
  interface EmployeeClient {
    findMany: (args: unknown) => Promise<EmployeeRow[]>;
    update: (args: unknown) => Promise<unknown>;
  }
  let encrypted = 0;
  let skipped = 0;
  await withBootstrap(async (tx) => {
    const employees = await ((tx as unknown as { employee: EmployeeClient }).employee.findMany({
      select: { id: true, nationalId: true, iban: true },
    }));
    for (const e of employees) {
      const data: Record<string, string | null> = {};
      for (const field of ['nationalId', 'iban'] as const) {
        const value = e[field];
        if (value === null || value === '' || isEncryptedValue(value)) {
          skipped += 1;
          continue;
        }
        data[field] = encryptor.encrypt(value);
        encrypted += 1;
      }
      if (Object.keys(data).length > 0) {
        await ((tx as unknown as { employee: EmployeeClient }).employee.update({ where: { id: e.id }, data }));
      }
    }
  });
  console.log(`Employee field encryption: ${encrypted} value(s) encrypted, ${skipped} already encrypted/empty (skipped).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
