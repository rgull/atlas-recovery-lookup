const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { validateRow, REQUIRED_COLUMNS } = require("./validators");

// File-level problems: nothing is imported.
class CsvImportError extends Error {}

function readRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new CsvImportError(`CSV file not found: ${filePath}`);
  }

  let header = [];
  let rows;
  try {
    rows = parse(fs.readFileSync(filePath, "utf8"), {
      bom: true,
      columns: (cols) => (header = cols.map((c) => c.trim().toLowerCase())),
      skip_empty_lines: true,
      trim: true,
      // A row with too few/many fields is validated (and skipped) on its own instead of aborting the whole file.
      relax_column_count: true,
    });
  } catch (err) {
    throw new CsvImportError(`Could not parse CSV (${filePath}): ${err.message}`);
  }

  if (rows.length === 0) {
    throw new CsvImportError(`CSV contains no data rows: ${filePath}`);
  }

  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) {
    throw new CsvImportError(
      `CSV is missing required column(s): ${missingColumns.join(", ")}. Found columns: ${header.join(", ")}`
    );
  }

  return rows;
}

/**
 * Validates every row of the CSV and upserts valid rows into `db`, in a single transaction.
 * Returns { messages, summary }. Throws CsvImportError for file-level problems.
 */
function importCsv(db, filePath) {
  const rows = readRows(filePath);

  const upsert = db.prepare(`
    INSERT INTO accounts (account_number, debtor_name, phone_number, balance, status, client_name, updated_at)
    VALUES (@account_number, @debtor_name, @phone_number, @balance, @status, @client_name, datetime('now'))
    ON CONFLICT(account_number) DO UPDATE SET
      debtor_name  = excluded.debtor_name,
      phone_number = excluded.phone_number,
      balance      = excluded.balance,
      status       = excluded.status,
      client_name  = excluded.client_name,
      updated_at   = excluded.updated_at
  `);
  const exists = db.prepare(`SELECT 1 FROM accounts WHERE account_number = ?`);

  const messages = [];
  const summary = { total: rows.length, inserted: 0, updated: 0, duplicatesInFile: 0, skipped: 0 };
  const seenInFile = new Set();

  db.transaction(() => {
    rows.forEach((row, idx) => {
      const rowNum = idx + 2; // +1 for header row, +1 for 1-indexing
      const result = validateRow(row);

      if (!result.valid) {
        summary.skipped += 1;
        messages.push(`Row ${rowNum} SKIPPED: ${result.errors.join("; ")}`);
        return;
      }

      const warnings = result.errors.filter((e) => e.startsWith("warning:"));
      if (warnings.length > 0) {
        messages.push(`Row ${rowNum} (${result.data.account_number}) ingested with warnings: ${warnings.join("; ")}`);
      }

      const key = result.data.account_number.toLowerCase();
      if (seenInFile.has(key)) {
        summary.duplicatesInFile += 1;
        messages.push(
          `Row ${rowNum}: duplicate account_number "${result.data.account_number}" in file — later row overwrites earlier one (last-row-wins policy)`
        );
      }
      seenInFile.add(key);

      const alreadyInDb = exists.get(result.data.account_number);
      upsert.run(result.data);
      if (alreadyInDb) summary.updated += 1;
      else summary.inserted += 1;
    });
  })();

  return { messages, summary };
}

module.exports = { importCsv, CsvImportError };
