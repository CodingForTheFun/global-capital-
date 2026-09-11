// Beta sign-up mode.
//
// The account gate is worthless if nobody can get through it, and right now
// nobody can: verification codes need a mail provider that is not configured,
// and Google sign-in needs credentials that do not exist yet. ACCOUNT_BETA_OPEN
// closes that gap by creating accounts already marked verified and signing the
// person straight in.
//
// What that costs, stated plainly because it is a real trade and not a free
// one:
//
//   • Nobody proves they own the address they typed. A typo is an account that
//     cannot be recovered, and password reset does not work at all until a mail
//     provider exists — there is nowhere to send the code.
//   • Registration stops being enumeration-proof. An instant sign-in has to
//     tell you the address was already taken, because otherwise it would have
//     to pretend to sign you into an account that is not yours. Every product
//     with instant sign-up makes this trade; it is worth knowing it was made.
//
// It is the right trade for a free beta with no payments and no sensitive data
// behind the gate, and the wrong one the moment either of those changes. Turn
// it off as soon as mail or Google is configured.

export function betaOpenSignup(env = process.env) {
  return String(env.ACCOUNT_BETA_OPEN || '').trim() === 'true';
}
