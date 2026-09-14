const fs = require("fs");
const path = require("path");
const { getDb } = require("./db");
const { importCsv, CsvImportError } = require("./importer");

const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "data", "atlas_inventory.csv");

const logPath = path.join(__dirname, "..", "data", "ingestion_errors.log");

const db = getDb();
let result;
try {
  result = importCsv(db, inputPath);
} catch (err) {
  if (!(err instanceof CsvImportError)) throw err;
  console.error(err.message);
  console.error("No records were imported.");
  process.exit(1);
} finally {
  db.close();
}

const { messages, summary } = result;
const summaryLines = [
  "",
  "=== Summary ===",
  `Total rows read:        ${summary.total}`,
  `Inserted (new):         ${summary.inserted}`,
  `Updated (existing):     ${summary.updated}`,
  `Duplicates within file: ${summary.duplicatesInFile}`,
  `Skipped (invalid):      ${summary.skipped}`,
];

messages.forEach((m) => console.warn(m));
summaryLines.forEach((l) => console.log(l));

fs.appendFileSync(
  logPath,
  [`=== Ingestion run: ${new Date().toISOString()} — source: ${inputPath} ===`, ...messages, ...summaryLines].join("\n") +
    "\n\n"
);
console.log(`\nFull log appended to: ${logPath}`);
