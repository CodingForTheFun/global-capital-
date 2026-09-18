---
always: true
---
Never print, log, echo, or commit the value of an API key, token, password,
verification code, or webhook secret for this project (Railway, Supabase,
PropLine, Stripe, PayPal, Resend, or any other provider). Check presence only
("is it set") when verifying configuration, never the value. Do not ask the
user to paste a secret into chat; if one is pasted anyway, treat it as
compromised and tell the user to rotate it rather than using it as given.
