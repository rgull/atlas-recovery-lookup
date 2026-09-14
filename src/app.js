const express = require("express");

function createApp(db) {
  const app = express();

  const selectByAccountNumber = db.prepare(`
    SELECT account_number, debtor_name, phone_number, balance, status, client_name
    FROM accounts
    WHERE account_number = ?
  `);

  function lookupAccount(req, res) {
    const accountNumber = (req.params.accountNumber || req.query.account_number || "").trim();

    if (!accountNumber) {
      return res.status(400).json({ error: "account_number is required" });
    }

    const account = selectByAccountNumber.get(accountNumber);

    if (!account) {
      return res.status(404).json({ error: "Account not found", account_number: accountNumber });
    }

    return res.json(account);
  }

  app.get("/accounts/:accountNumber", lookupAccount);
  app.get("/accounts", lookupAccount);

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.use((req, res) => res.status(404).json({ error: "Route not found" }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
