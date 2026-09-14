const { getDb, DB_PATH } = require("./db");
const { createApp } = require("./app");

const db = getDb();

const { count } = db.prepare("SELECT COUNT(*) AS count FROM accounts").get();
if (count === 0) {
  console.warn(`No accounts in ${DB_PATH} — run "npm run ingest" first.`);
}

const PORT = process.env.PORT || 3000;
createApp(db).listen(PORT, () => {
  console.log(`Atlas Recovery lookup API listening on port ${PORT} (${count} accounts)`);
});
