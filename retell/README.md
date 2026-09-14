# Retell AI Agent — Atlas Recovery Agent

- **Agent:** `Atlas Recovery Agent` (`agent_c978aff79c7c2400a6d265a097`), voice `cartesia-Cleo`, `en-US`
- **Conversation flow:** `conversation_flow_014ac191b354`
- **Export (deliverable):** [`Atlas Recovery Agent.json`](<Atlas Recovery Agent.json>), exported from the Retell dashboard (agent config + full conversation flow, importable into Retell)

The agent is built from code ([`build-agent.js`](build-agent.js)) through Retell's API instead of
by hand in the dashboard, so the flow is version-controlled and reproducible:

```bash
RETELL_API_KEY=key_xxx PUBLIC_API_URL=https://<your-api-host> node retell/build-agent.js
```

Re-running updates the same agent (IDs are cached in `retell/.retell-ids.json`). After a change,
export again from the dashboard (Agent → Export).

## Voice and speaking style

- Speaks as **Nancy**, calling on behalf of the account's client (e.g. Alpha Bank)
- Voice: **Cleo** (`cartesia-Cleo`), language English (US)
- Model: `gpt-4.1`, temperature 0.2
- Global rules: polite and professional, short natural sentences, one question at a time, calm
  if the consumer is upset, money amounts spoken naturally, never invents account details, never
  discusses the debt before identity is verified

## Flow

```
Look Up Account (GET /accounts?account_number={{account_number}})
  ├─ not found ─────────────► End: "trouble pulling up information"
  └─ found ─► 1. Greeting: "Hello, this is Nancy from {{client_name}}. Is this {{debtor_name}}?"
               ├─ yes ─► 2. Identity Verification
               └─ no ──► "I'm trying to reach {{debtor_name}}. May I speak with them?"
                          ├─ comes to phone ─► 2. Identity Verification
                          ├─ not available ──► "Can you take a message?" ─► End
                          └─ wrong person ───► End politely

2. Identity Verification: "Thanks {{debtor_name}}. Can you please confirm the last 4 digits of your SSN?"
  ├─ refuses / can't ─► Transfer to live agent
  └─ gives digits ─► Capture digits ─► exact match to 1234?
                                        ├─ no ─► Transfer to live agent
                                        └─ yes ─► Calculate payment options (code) ─► 3. Payment Negotiation

3. Payment Negotiation: balance ─► full payment ─► 3-month plan ─► negotiate (≤24 months, ≥80% settlement)
  ├─ agreement confirmed ─► End with recap
  ├─ disputes debt / wants a person ─► Transfer to live agent
  └─ no agreement ─► End politely
```

## Design decisions

| Decision | Why |
|---|---|
| Account lookup runs first, keyed on `{{account_number}}` passed in at call start | Atlas's dialer knows which account it's calling. Passing it directly (not via the LLM) means the lookup can't be hallucinated. The name, client and balance in the script come from the API instead of being hardcoded. |
| SSN check is an **equation** edge (`ssn_last4_given == expected_ssn_last4`), not an LLM judgement | Identity verification is a compliance gate. An LLM "deciding" whether digits match is not reliable enough. `1234` is set as a default dynamic variable per the script; in production it would be injected per call from a secure source, never from this lookup API. |
| Payment amounts are calculated in a **code node** before negotiation | LLMs are unreliable at arithmetic. The 3/6/12/24-month payments and the 90%/80% settlement amounts are computed exactly, and the prompt tells the agent to use them. |
| 24-month maximum and 80% floor are stated as hard limits in the prompt, with the exact floor amount | The agent can say "that's not something I can offer" and suggest the closest allowed option, rather than drifting under pressure. |
| Nothing about the debt is disclosed before verification (global prompt + message-taking node) | Third-party disclosure rules for collections (FDCPA). The "take a message" branch leaves only a name and a callback request. |
| Low temperature (0.2), `gpt-4.1` | Consistent, script-following behavior over creativity. |
| Extra "disputes the debt / asks for a person" exit from negotiation | Not in the script, but a real call needs it, and the agent should not keep negotiating with someone disputing the debt. |

## Testing

In the Retell dashboard, open the agent and use **Test** (web call or chat). The default
dynamic variables load account `ACC1001` (John Doe, Alpha Bank, $1,250.50) with SSN last 4 `1234`.
To test other accounts, override `account_number` in the test panel (for example `ACC1014`, or
`ACC9999` for the not-found path).

Scenarios to run:
1. Confirms identity, gives `1234`, pays in full
2. Confirms identity, gives `1234`, declines full amount, accepts the 3-month plan
3. Declines the 3-month plan, pushes for 36 months or a 50% settlement (agent should refuse and offer ≤24 months / ≥80%)
4. Gives the wrong SSN digits, or refuses to give them (should transfer to a live agent)
5. "No, this isn't John": not available (take a message) / wrong number (end politely)
6. Says they don't owe the debt during negotiation (should transfer to a live agent)
7. `account_number = ACC9999` (account not found path)

Scenarios 1–6 were run as test calls in the Retell dashboard and behaved as expected.

## Limitations of this prototype

- The lookup calls the deployed API at `https://atlas-recovery-lookup.vercel.app`, which serves the
  bundled sample CSV. Updating the inventory means committing a new CSV and redeploying.
- "Transfer to live agent" is modeled as an end node with a transfer message. A real `transfer_call`
  node needs Atlas's live-agent phone number.
