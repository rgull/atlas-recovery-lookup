const VALID_STATUSES = new Set([
  "active",
  "closed",
  "settlement eligible",
  "bankruptcy",
  "disputed",
]);

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Strict decimal only: Number() alone would accept "1e3", "0x10", "Infinity".
const BALANCE_PATTERN = /^-?\d+(\.\d+)?$/;

function parseBalance(raw) {
  const cleaned = cleanString(raw).replace(/[$,]/g, "");
  if (cleaned === "") return { ok: false, reason: "missing" };
  if (!BALANCE_PATTERN.test(cleaned)) return { ok: false, reason: "not a number" };
  const num = Number(cleaned);
  if (num < 0) return { ok: false, reason: "negative" };
  return { ok: true, value: Math.round(num * 100) / 100 };
}

function normalizePhone(raw) {
  const cleaned = cleanString(raw);
  if (cleaned === "") return "";
  const digits = cleaned.replace(/[^\d+]/g, "");
  return digits;
}

/**
 * Validates and normalizes a single CSV row.
 * Returns { valid: boolean, data?: object, errors: string[] }
 */
function validateRow(row) {
  const errors = [];

  const account_number = cleanString(row.account_number);
  if (!account_number) errors.push("missing account_number");

  const debtor_name = cleanString(row.debtor_name);
  if (!debtor_name) errors.push("missing debtor_name");

  const balanceResult = parseBalance(row.balance);
  if (!balanceResult.ok) errors.push(`invalid balance (${balanceResult.reason}): "${row.balance ?? ""}"`);

  const status = cleanString(row.status);
  if (!status) errors.push("missing status");
  else if (!VALID_STATUSES.has(status.toLowerCase())) {
    // Unknown status values are allowed through (Atlas may add new ones),
    // but flagged so they surface during review instead of failing silently.
    errors.push(`warning: unrecognized status "${status}"`);
  }

  const phone_number = normalizePhone(row.phone_number);
  if (!phone_number) errors.push("warning: missing phone_number");

  const client_name = cleanString(row.client_name);

  // Only errors without the "warning:" prefix block ingestion.
  const blocking = errors.filter((e) => !e.startsWith("warning:"));

  if (blocking.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      account_number,
      debtor_name,
      phone_number,
      balance: balanceResult.value,
      status,
      client_name,
    },
    errors, // may still contain non-blocking warnings
  };
}

const REQUIRED_COLUMNS = ["account_number", "debtor_name", "phone_number", "balance", "status", "client_name"];

module.exports = { validateRow, parseBalance, normalizePhone, REQUIRED_COLUMNS };
