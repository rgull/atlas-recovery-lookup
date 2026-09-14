CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT PRIMARY KEY COLLATE NOCASE,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance        REAL NOT NULL CHECK (balance >= 0),
  status         TEXT NOT NULL,
  client_name    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_phone_number ON accounts(phone_number);
