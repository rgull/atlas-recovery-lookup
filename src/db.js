const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "atlas.db");
const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

function getDb(dbPath = DB_PATH) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return db;
}

module.exports = { getDb, DB_PATH };
