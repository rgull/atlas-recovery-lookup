Subject: Update on the payment plan eligibility issue — root cause identified and resolved

Hi Atlas Recovery team,

Thank you for flagging this, and I want to apologize for the experience these
consumers had. I know how important it is that the agent gives consumers
accurate, compliant information about their options, and I want to walk you
through exactly what happened, what we fixed, and what we've put in place to
make sure it doesn't happen again.

**What happened**

We traced this to a configuration change made during a recent update to the
agent's account-status handling. That change inadvertently mapped accounts
with a status of "Settlement Eligible" into the same bucket as statuses that
are *not* eligible for a payment plan. In practice, this meant that any
consumer whose account carried the Settlement Eligible status was incorrectly
told during the call that they didn't qualify for a payment plan — when they
in fact did.

**What we changed**

We corrected the eligibility mapping so that Settlement Eligible accounts are
now correctly routed to the payment plan offer flow, consistent with how they
were handled before the configuration change. This was a targeted fix to the
status-to-eligibility mapping itself; no other call flow logic was touched.

**How we confirmed the fix**

Before marking this resolved, we:
- Re-ran test calls specifically against accounts with the Settlement Eligible
  status and confirmed the agent now correctly offers the payment plan.
- Re-tested the other account statuses in the same mapping (e.g., Active,
  Closed, Bankruptcy) to confirm the fix didn't change their behavior.
- Reviewed the fix in a staging environment against the affected scenarios
  before promoting it to production.

The fix is live now, and we've spot-checked recent calls post-deployment to
confirm the corrected behavior is holding in production.

**What we did to prevent this from happening again**

- We added an automated test that checks every account status against its
  expected payment-plan eligibility. Any future configuration change that
  alters this mapping will now fail that test and be blocked before it can
  reach production.
- Changes to eligibility and status mappings now require review and sign-off
  from a second team member before they are deployed, since they directly
  affect what consumers are told.
- We added a daily check that compares the payment-plan outcomes on calls
  against each account's status, so a mismatch like this would be flagged
  within a day rather than surfacing through consumer calls.

We have also pulled the list of calls during the affected window where a
Settlement Eligible consumer was told they were not eligible for a payment
plan. I'd be glad to share it so you can review those calls, and to discuss
whether you'd like us to follow up with those consumers to offer the correct
payment plan options.

If you have any other questions, I'm happy to set up a call this week to walk
through any of this in more detail.

Best regards,
Customer Success Team
