# Atlas Recovery - Account Lookup

Atlas Recovery's AI voice agent could only find a debtor's account by phone number. This project
adds lookup by account number, using the inventory CSV that Atlas uploads.

It has four pieces:

1. A CSV ingestion script that validates the inventory file and loads it into SQLite
2. An HTTP API that returns an account by account number
3. A Retell AI conversation flow agent that uses the API during calls
4. A customer email about a payment plan eligibility incident ([CUSTOMER_EMAIL.md](CUSTOMER_EMAIL.md))

Live API: https://atlas-recovery-lookup.vercel.app/accounts/ACC1001

## Stack

- Node.js 22, Express
- SQLite via `better-sqlite3`
- `csv-parse` for reading the CSV
- Vercel for hosting
- Retell AI for the voice agent (GPT-4.1)

I went with SQLite because it needs no server or account. The whole database is one file, so
anyone can clone the repo and have it running in a couple of minutes.

## Project layout

```
src/
  schema.sql      table definition
  db.js           opens the database and applies the schema
  validators.js   row validation and normalization
  importer.js     CSV import logic (used by the CLI and by the Vercel function)
  ingest.js       CLI entry point for `npm run ingest`
  app.js          Express routes
  server.js       local server for `npm start`
api/
  index.js        Vercel serverless entry point
data/
  atlas_inventory.csv   sample inventory, includes some bad rows on purpose
retell/
  Atlas Recovery Agent.json   agent export from the Retell dashboard
  build-agent.js              creates/updates the agent through the Retell API
  README.md                   more detail on the agent
CUSTOMER_EMAIL.md
vercel.json
```

## Running it locally

```bash
npm install
npm run ingest
npm start
```

The API starts on http://localhost:3000. Use `PORT=4000 npm start` to change the port, or
`npm run dev` to restart automatically when files change.

To load a different file:

```bash
npm run ingest -- path/to/file.csv
```

## Database

One table:

```sql
CREATE TABLE accounts (
  account_number TEXT PRIMARY KEY COLLATE NOCASE,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance        REAL NOT NULL CHECK (balance >= 0),
  status         TEXT NOT NULL,
  client_name    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_phone_number ON accounts(phone_number);
```

The schema is applied automatically the first time the database is opened, so there's no
separate migration step.

A few notes on the choices here:

- `account_number` is case-insensitive. On a phone call the number could come through as
  `acc1001`, and that should still match `ACC1001`.
- `phone_number` is indexed so phone lookups against the same table stay fast.
- `balance` can't be negative. See the validation section below.

## CSV ingestion

Expected columns: `account_number, debtor_name, phone_number, balance, status, client_name`.
Column order doesn't matter, and a UTF-8 BOM (common in files saved from Excel) is handled.

### Duplicate account numbers

If an account number is already in the database, or appears twice in the same file, the later
row overwrites the earlier one.

The file is Atlas's current inventory and gets re-uploaded periodically, so the newest row has
the current balance and status. Skipping duplicates would leave old balances in place, and the
agent would quote the wrong amount. Failing the whole import would block a routine update over
something that's expected to happen. Every overwrite is logged, and running the same file twice
is safe.

### Validation

If there's a problem with the file itself, the import stops and nothing gets written:

- file doesn't exist
- file is empty
- file can't be parsed (for example an unclosed quote)
- a required column is missing

Otherwise each row is checked on its own. These rows are skipped:

- missing `account_number`, `debtor_name` or `status`
- `balance` missing, not a plain number, or negative

For `balance`, `$` and commas are fine (`"$1,200.00"` works). Values like `N/A`, `1e3` or `0x10`
are rejected. A negative balance is treated as a data error rather than a credit, since the
agent would otherwise tell someone they owe a negative amount.

These rows are imported, with a warning:

- missing `phone_number` (the account can still be found by account number)
- a `status` other than Active, Closed, Settlement Eligible, Bankruptcy or Disputed. Atlas might
  add new statuses, and that shouldn't break the import.

All valid rows are written in a single transaction.

### Output

The script prints each skipped or flagged row and a summary. The same details are appended to
`data/ingestion_errors.log`.

Running it against the sample file:

```
Row 8 (ACC1007) ingested with warnings: warning: missing phone_number
Row 9 SKIPPED: missing account_number
Row 10 SKIPPED: invalid balance (not a number): "N/A"
Row 12: duplicate account_number "ACC1002" in file — later row overwrites earlier one (last-row-wins policy)
Row 14 (ACC1012) ingested with warnings: warning: unrecognized status "UnknownStatusXYZ"
Row 17 SKIPPED: invalid balance (missing): ""; warning: missing phone_number
Row 18 SKIPPED: invalid balance (negative): "-125.00"

=== Summary ===
Total rows read:        17
Inserted (new):         12
Updated (existing):     1
Duplicates within file: 1
Skipped (invalid):      4
```

Row numbers match the line numbers in the CSV (line 1 is the header).

## API

```
GET /accounts/:accountNumber
GET /accounts?account_number=...
GET /health
```

Found:

```
GET /accounts/ACC1001
200 {"account_number":"ACC1001","debtor_name":"John Doe","phone_number":"5551234567","balance":1250.5,"status":"Active","client_name":"Alpha Bank"}
```

Not found:

```
GET /accounts/ACC9999
404 {"error":"Account not found","account_number":"ACC9999"}
```

No account number:

```
GET /accounts
400 {"error":"account_number is required"}
```

Unknown routes return a 404 and server errors return a 500, both as JSON, since the agent is
the one reading these responses.

## Deployment

The API runs on Vercel: https://atlas-recovery-lookup.vercel.app

To deploy your own copy, import the repo in Vercel (Add New > Project) and deploy with the
default settings. `vercel.json` sends every request to `api/index.js`.

Vercel functions can't write to disk, so the deployed version doesn't use the database file.
When a function starts, it loads `data/atlas_inventory.csv` into an in-memory SQLite database,
using the same schema and the same import code as `npm run ingest`. The CSV and source files
aren't reachable over HTTP. To update the data, commit a new CSV and Vercel redeploys.

For a real setup I'd move to a hosted Postgres database, so Atlas could upload a new file
without a redeploy. `src/db.js` is the only file that talks to the database driver.

If you just need a temporary public URL without an account, run
`cloudflared tunnel --url http://localhost:3000` while the local server is running.

## Retell AI agent

A Conversation Flow agent called "Atlas Recovery Agent", built from the call script. The export
is in [retell/Atlas Recovery Agent.json](<retell/Atlas Recovery Agent.json>).

It speaks as "Nancy" using the Cleo voice in English (US), on GPT-4.1 with temperature 0.2.
The global prompt keeps it polite and brief: one question at a time, stay calm if the person is
upset, and never make up account details.

### Call flow

1. **Look up the account.** Before saying anything, the agent calls
   `GET /accounts?account_number={{account_number}}`. The account number is passed in when the
   call starts. If the account isn't found, it apologizes and ends the call.
2. **Greeting.** "Hello, this is Nancy from {{client_name}}. Is this {{debtor_name}}?"
   - If it's the right person, it moves on to verification.
   - If not, it asks to speak with them. If they're not available it offers to take a message.
     If it's a wrong number, it ends the call politely.
3. **Identity verification.** It asks for the last 4 digits of the SSN. If they don't match
   `1234` (from the script), or the person won't give them, it says it will transfer the call
   to a live agent.
4. **Payment negotiation.** It states the balance and asks for full payment. If that doesn't
   work it offers a 3-month plan, then negotiates from there: up to 24 months, or a one-time
   settlement starting at 90% and never below 80%. If the person disputes the debt, it
   transfers them.

### How it's built

- The account number is passed straight into the API call, so the model can't get it wrong.
- The SSN check is an exact comparison in the flow, not something the model decides.
- A code node calculates every payment amount (3, 6, 12 and 24 months, plus the 90% and 80%
  settlement amounts) before negotiation starts. The model is told to use those numbers
  instead of doing the math itself.
- The 24-month and 80% limits are written into the prompt as hard rules, with the exact
  minimum settlement amount.
- Nothing about the debt is mentioned until the person is verified. When taking a message, it
  only leaves a name and asks for a call back. This follows third-party disclosure rules for
  debt collection.

The flow is defined in code in `retell/build-agent.js`, which creates the agent through the
Retell API, or updates it if it already exists:

```bash
RETELL_API_KEY=your_key PUBLIC_API_URL=https://atlas-recovery-lookup.vercel.app node retell/build-agent.js
```

After a change, export the agent again from the Retell dashboard.

## Testing

There's no automated test suite. Everything below was tested by hand.

### API

With the local server running, or using the live URL:

```bash
curl http://localhost:3000/accounts/ACC1001                  # 200, John Doe
curl http://localhost:3000/accounts/acc1014                  # 200, lowercase works
curl "http://localhost:3000/accounts?account_number=ACC1002" # 200, Jane Smith (the later duplicate row: Closed, 750)
curl http://localhost:3000/accounts/ACC9999                  # 404
curl http://localhost:3000/accounts/ACC1009                  # 404, rejected at import (balance was N/A)
curl http://localhost:3000/accounts                          # 400
```

### Ingestion

The sample CSV covers the row-level cases. For the file-level cases, point the script at a
missing file, an empty file, or a file with a renamed column (for example `acct_no` instead of
`account_number`). Each one should exit with code 1 and import nothing.

### Agent

In the Retell dashboard, open the agent and click Test. It uses account `ACC1001` (John Doe,
$1,250.50) by default, and the SSN last 4 is `1234`.

| What to say | What should happen |
|---|---|
| Yes, 1234, I can pay in full | Confirms the full $1,250.50 |
| Yes, 1234, can't pay in full, 3 months is fine | Offers 3 payments of $416.83 |
| Yes, 1234, decline 3 months, ask for 36 months | Declines, offers 24 months max ($52.10/month) |
| Yes, 1234, ask to pay half | Declines, won't go below $1,000.40 (80%) |
| Yes, 5678 | Transfers to a live agent |
| No, he's not home | Offers to take a message, doesn't mention the debt |
| No, wrong number | Apologizes and ends the call |
| Yes, 1234, I don't owe this | Transfers to a live agent |

To try another account, change `account_number` under dynamic variables in the test panel.
`ACC1014` is Kevin Harris ($4,500.25), and `ACC9999` tests the not-found path.

## Known limitations

- The live API serves the sample CSV bundled with the repo. There's no upload endpoint yet.
- "Transfer to a live agent" plays a message and ends the call. A real transfer needs Atlas's
  live agent phone number, and then it's a small change in Retell.
- The expected SSN digits (`1234`) are a default value in the agent, as in the script. In
  production they'd be passed in per call from a secure source, never from this API.
- No authentication on the API. Before handling real data it would need at least an API key
  that the agent sends in a header.
