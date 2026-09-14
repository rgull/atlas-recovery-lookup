// Creates (or updates) the Atlas Recovery conversation-flow agent in Retell via API.
// Export the result from the Retell dashboard (Agent → Export) to "Atlas Recovery Agent.json".
//
// Usage:
//   RETELL_API_KEY=key_xxx PUBLIC_API_URL=https://your-api.example.com node retell/build-agent.js

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.RETELL_API_KEY;
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
const VOICE_ID = process.env.RETELL_VOICE_ID;
const RETELL = "https://api.retellai.com";
const IDS_FILE = path.join(__dirname, ".retell-ids.json");

if (!API_KEY || !PUBLIC_API_URL) {
  console.error("RETELL_API_KEY and PUBLIC_API_URL are required.");
  process.exit(1);
}

async function retell(method, endpoint, body) {
  const res = await fetch(`${RETELL}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

const promptEdge = (id, prompt, destination_node_id) => ({
  id,
  transition_condition: { type: "prompt", prompt },
  destination_node_id,
});

const GLOBAL_PROMPT = `
You are Nancy, a courteous, professional collections representative calling on behalf of {{client_name}}.

Rules that apply at every step:
- Speak naturally and concisely, like a real phone call. One question at a time.
- Never mention the debt, the balance, the account, or the reason for the call to anyone until their identity has been verified. If you are speaking with someone other than the account holder, do not reveal why you are calling.
- Never invent account details. Only use the values provided to you in variables.
- Stay calm and respectful even if the consumer is upset. Never threaten, pressure aggressively, or make promises outside the rules you are given.
- All money amounts are in US dollars. Say amounts naturally (e.g. "one thousand two hundred fifty dollars and fifty cents").
`.trim();

const NEGOTIATION_PROMPT = `
The consumer, {{debtor_name}}, has been verified. Their account with {{client_name}} has a balance of \${{balance_formatted}}.

Pre-calculated figures (use these exact numbers, do not recalculate):
- Full balance: \${{balance_formatted}}
- 3-month payment plan: 3 monthly payments of \${{three_month_payment}}
- 6-month payment plan: 6 monthly payments of \${{six_month_payment}}
- 12-month payment plan: 12 monthly payments of \${{twelve_month_payment}}
- 24-month payment plan (the longest allowed): 24 monthly payments of \${{twenty_four_month_payment}}
- Settlement opening offer (90%): one-time payment of \${{settlement_90_amount}}
- Settlement floor (80%, the lowest allowed): one-time payment of \${{settlement_80_amount}}

Follow this negotiation order:
1. Tell them their current balance and ask whether they are able to pay the full amount today.
2. If they cannot pay in full, offer the 3-month payment plan.
3. If they decline the 3-month plan, ask what monthly amount would be manageable for them, then work with them:
   - Offer a longer payment plan that fits their budget (6, 12, up to a maximum of 24 months). For a custom length between these, divide the balance by the number of months and round to the cent.
   - Or offer a one-time settlement: start at the 90% amount; only if they still cannot do that, you may come down, but never below the 80% floor.
4. Hard limits — never break these, even if the consumer pushes:
   - Never offer or accept a payment plan longer than 24 months.
   - Never offer or accept a settlement below \${{settlement_80_amount}} (80% of the balance).
   If they ask for something outside these limits, politely explain it's not something you can offer and present the closest option that is allowed.
5. Once they agree to something, clearly repeat the agreed terms back (amount, number of payments, frequency) and confirm they agree.
`.trim();

const NEGOTIATION_MATH = `
const balance = Number(dv.balance);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
return {
  balance_formatted: money(balance),
  three_month_payment: money(balance / 3),
  six_month_payment: money(balance / 6),
  twelve_month_payment: money(balance / 12),
  twenty_four_month_payment: money(balance / 24),
  settlement_90_amount: money(balance * 0.9),
  settlement_80_amount: money(balance * 0.8),
};
`.trim();

function buildFlow() {
  return {
    start_speaker: "agent",
    model_choice: { type: "cascading", model: "gpt-4.1" },
    model_temperature: 0.2,
    global_prompt: GLOBAL_PROMPT,
    start_node_id: "lookup_account",
    default_dynamic_variables: {
      // Injected per call by Atlas's dialer in production; defaults allow dashboard testing.
      account_number: "ACC1001",
      expected_ssn_last4: "1234",
    },
    tools: [
      {
        type: "custom",
        tool_id: "lookup_account",
        name: "lookup_account",
        description: "Looks up the debtor account by account number in Atlas Recovery's account database.",
        url: `${PUBLIC_API_URL}/accounts`,
        method: "GET",
        query_params: { account_number: "{{account_number}}" },
        parameters: { type: "object", properties: {} },
        response_variables: {
          debtor_name: "debtor_name",
          phone_number: "phone_number",
          balance: "balance",
          status: "status",
          client_name: "client_name",
        },
        speak_during_execution: false,
        speak_after_execution: false,
        timeout_ms: 10000,
        max_retry: 0,
      },
    ],
    nodes: [
      {
        id: "lookup_account",
        name: "Look Up Account",
        type: "function",
        tool_id: "lookup_account",
        tool_type: "local",
        wait_for_result: true,
        speak_during_execution: false,
        edges: [
          {
            id: "edge_account_found",
            transition_condition: {
              type: "equation",
              equations: [{ left: "{{debtor_name}}", operator: "exists" }],
              operator: "&&",
            },
            destination_node_id: "greeting",
          },
        ],
        else_edge: promptEdge("edge_account_not_found", "Else", "account_not_found"),
      },
      {
        id: "account_not_found",
        name: "Account Not Found",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "static_text",
          text: "Hello, this is Nancy. I'm sorry, I'm having trouble pulling up the right information on my end, so I'll have someone follow up with you shortly. Thank you, and have a good day.",
        },
      },
      {
        id: "greeting",
        name: "1. Greeting",
        type: "conversation",
        instruction: {
          type: "static_text",
          text: "Hello, this is Nancy from {{client_name}}. Is this {{debtor_name}}?",
        },
        edges: [
          promptEdge("edge_is_debtor", "The person confirms they are {{debtor_name}}", "identity_verification"),
          promptEdge("edge_not_debtor", "The person says they are not {{debtor_name}}", "ask_for_debtor"),
        ],
      },
      {
        id: "ask_for_debtor",
        name: "1b. Ask For Debtor",
        type: "conversation",
        instruction: {
          type: "static_text",
          text: "I'm trying to reach {{debtor_name}}. May I speak with them?",
        },
        edges: [
          promptEdge(
            "edge_debtor_comes_to_phone",
            "{{debtor_name}} comes to the phone, or the person now says they are {{debtor_name}}",
            "identity_verification"
          ),
          promptEdge(
            "edge_debtor_unavailable",
            "The person knows {{debtor_name}} but says they are not available right now",
            "take_message"
          ),
          promptEdge(
            "edge_wrong_person",
            "The person says {{debtor_name}} does not live there, they don't know them, or it's a wrong number",
            "end_wrong_person"
          ),
        ],
      },
      {
        id: "take_message",
        name: "1c. Take A Message",
        type: "conversation",
        instruction: {
          type: "prompt",
          text: `Ask: "Can you take a message?" If they agree, ask them to let {{debtor_name}} know that Nancy from {{client_name}} called and asks them to call back at their earliest convenience. Do not say why you are calling, and do not mention any debt, balance, or account details. If they decline, thank them politely.`,
        },
        edges: [
          promptEdge("edge_message_done", "The person has agreed to pass on the message, or has declined to take one", "end_message"),
        ],
      },
      {
        id: "end_message",
        name: "End - Message Left",
        type: "end",
        speak_during_execution: true,
        instruction: { type: "static_text", text: "Thank you so much for your help. Have a great day. Goodbye." },
      },
      {
        id: "end_wrong_person",
        name: "End - Wrong Person",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "static_text",
          text: "I apologize for the inconvenience, I must have the wrong number. Have a great day. Goodbye.",
        },
      },
      {
        id: "identity_verification",
        name: "2. Identity Verification",
        type: "conversation",
        instruction: {
          type: "static_text",
          text: "Thanks {{debtor_name}}. Can you please confirm the last 4 digits of your social security number?",
        },
        edges: [
          promptEdge("edge_digits_given", "The person provides digits for the last 4 of their social security number", "extract_ssn"),
          promptEdge(
            "edge_cannot_verify",
            "The person refuses, doesn't know, or cannot provide the last 4 digits of their social security number",
            "transfer_live_agent"
          ),
        ],
      },
      {
        id: "extract_ssn",
        name: "Capture SSN Last 4",
        type: "extract_dynamic_variables",
        variables: [
          {
            type: "string",
            name: "ssn_last4_given",
            description:
              "The last 4 digits of the social security number the person just said, as exactly 4 numeric characters with no spaces or punctuation (e.g. 'one two three four' -> '1234').",
          },
        ],
        edges: [
          {
            id: "edge_ssn_match",
            transition_condition: {
              type: "equation",
              equations: [{ left: "{{ssn_last4_given}}", operator: "==", right: "{{expected_ssn_last4}}" }],
              operator: "&&",
            },
            destination_node_id: "negotiation_math",
          },
        ],
        else_edge: promptEdge("edge_ssn_mismatch", "Else", "transfer_live_agent"),
      },
      {
        id: "transfer_live_agent",
        name: "2b. Transfer To Live Agent",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "static_text",
          text: "I'm sorry, I wasn't able to verify your identity. I'm going to transfer you to a live agent who can help you further. Please hold.",
        },
      },
      {
        id: "negotiation_math",
        name: "Calculate Payment Options",
        type: "code",
        code: NEGOTIATION_MATH,
        wait_for_result: true,
        speak_during_execution: false,
        timeout_ms: 5000,
        response_variables: {
          balance_formatted: "balance_formatted",
          three_month_payment: "three_month_payment",
          six_month_payment: "six_month_payment",
          twelve_month_payment: "twelve_month_payment",
          twenty_four_month_payment: "twenty_four_month_payment",
          settlement_90_amount: "settlement_90_amount",
          settlement_80_amount: "settlement_80_amount",
        },
        edges: [],
        else_edge: promptEdge("edge_math_done", "Else", "payment_negotiation"),
      },
      {
        id: "payment_negotiation",
        name: "3. Payment Negotiation",
        type: "conversation",
        instruction: { type: "prompt", text: NEGOTIATION_PROMPT },
        edges: [
          promptEdge(
            "edge_agreement_reached",
            "The consumer has agreed to pay in full, a payment plan, or a settlement, and has confirmed the terms you repeated back",
            "end_agreement"
          ),
          promptEdge(
            "edge_disputes_debt",
            "The consumer says they do not owe this debt, disputes the balance, or asks to speak with a person",
            "transfer_live_agent_dispute"
          ),
          promptEdge(
            "edge_no_agreement",
            "The consumer has declined every option within the allowed limits, or clearly wants to end the call without an arrangement",
            "end_no_agreement"
          ),
        ],
      },
      {
        id: "transfer_live_agent_dispute",
        name: "3b. Transfer - Dispute/Request",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "static_text",
          text: "I understand. Let me transfer you to a live agent who can look into this with you. Please hold.",
        },
      },
      {
        id: "end_agreement",
        name: "End - Arrangement Made",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "prompt",
          text: "Thank {{debtor_name}}, briefly recap the arrangement they just agreed to in one sentence, let them know they'll receive a confirmation with the details, and say goodbye.",
        },
      },
      {
        id: "end_no_agreement",
        name: "End - No Arrangement",
        type: "end",
        speak_during_execution: true,
        instruction: {
          type: "prompt",
          text: "Thank {{debtor_name}} for their time, let them know they can call {{client_name}} back any time to set up an arrangement, and say goodbye politely.",
        },
      },
    ],
  };
}

async function pickVoice() {
  if (VOICE_ID) return VOICE_ID;
  const voices = await retell("GET", "/list-voices");
  const female = voices.find((v) => v.gender === "female" && (v.accent || "").toLowerCase().includes("american"));
  const chosen = female || voices.find((v) => v.gender === "female") || voices[0];
  console.log(`Using voice: ${chosen.voice_name} (${chosen.voice_id})`);
  return chosen.voice_id;
}

async function main() {
  const ids = fs.existsSync(IDS_FILE) ? JSON.parse(fs.readFileSync(IDS_FILE, "utf8")) : {};
  const flowBody = buildFlow();

  let flow;
  if (ids.conversation_flow_id) {
    flow = await retell("PATCH", `/update-conversation-flow/${ids.conversation_flow_id}`, flowBody);
    console.log(`Updated conversation flow ${flow.conversation_flow_id}`);
  } else {
    flow = await retell("POST", "/create-conversation-flow", flowBody);
    console.log(`Created conversation flow ${flow.conversation_flow_id}`);
  }

  const agentBody = {
    agent_name: "Atlas Recovery Agent",
    response_engine: { type: "conversation-flow", conversation_flow_id: flow.conversation_flow_id },
    language: "en-US",
  };

  let agent;
  if (ids.agent_id) {
    agent = await retell("PATCH", `/update-agent/${ids.agent_id}`, agentBody);
    console.log(`Updated agent ${agent.agent_id}`);
  } else {
    agent = await retell("POST", "/create-agent", { ...agentBody, voice_id: await pickVoice() });
    console.log(`Created agent ${agent.agent_id}`);
  }

  fs.writeFileSync(
    IDS_FILE,
    JSON.stringify({ conversation_flow_id: flow.conversation_flow_id, agent_id: agent.agent_id }, null, 2)
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
