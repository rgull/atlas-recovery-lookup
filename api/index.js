const path = require("path");
const { getDb } = require("../src/db");
const { importCsv } = require("../src/importer");
const { createApp } = require("../src/app");

// Vercel functions have a read-only filesystem, so each instance loads the bundled CSV
// into an in-memory database (same schema and validation as `npm run ingest`) on cold start.
const db = getDb(":memory:");
const { summary } = importCsv(db, path.join(__dirname, "..", "data", "atlas_inventory.csv"));
console.log("Loaded accounts into memory:", JSON.stringify(summary));

module.exports = createApp(db);
