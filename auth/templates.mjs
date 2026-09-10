import { mailerConfig } from './mailer.mjs';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[c]));

function shell({ heading, intro, code, codeLabel, outro, footnote }) {
  const config = mailerConfig();
  const codeBlock = code
    ? `<tr><td style="padding:6px 0 22px">
         <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.16em;color:#5ee7ff;text-transform:uppercase;padding-bottom:10px">${escapeHtml(codeLabel || 'Your code')}</div>
         <div style="font:800 34px/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.34em;color:#f5f8fc;background:#0f1e31;border:1px solid rgba(94,231,255,.25);border-radius:14px;padding:20px 12px;text-align:center">${escapeHtml(code)}</div>
       </td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#07101d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07101d;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0b1727;border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:32px">
        <tr><td style="font:800 17px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#f5f8fc;padding-bottom:26px">
          AutoProp <span style="color:#5ee7ff;font-weight:600">Scout Pro</span>
        </td></tr>
        <tr><td style="font:800 25px/1.25 -apple-system,Segoe UI,Roboto,sans-serif;color:#f5f8fc;letter-spacing:-.02em;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
        <tr><td style="font:400 14px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#9fb1c8;padding-bottom:22px">${intro}</td></tr>
        ${codeBlock}
        <tr><td style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#9fb1c8;padding-bottom:20px">${outro}</td></tr>
        <tr><td style="border-top:1px solid rgba(255,255,255,.09);padding-top:18px;font:400 11px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#70849d">
          ${footnote}${config.appUrl ? `<br />${escapeHtml(config.appUrl)}` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function contextLine({ ip, userAgent }) {
  const parts = [];
  if (ip) parts.push(`IP ${ip}`);
  if (userAgent) parts.push(String(userAgent).slice(0, 120));
  return parts.length ? parts.join(' · ') : 'Unknown device';
}

export function verificationEmail({ code, displayName, minutes }) {
  const who = displayName ? `${displayName}, ` : '';
  return {
    subject: `${code} is your AutoProp verification code`,
    text: `${who}welcome to AutoProp Scout Pro.\n\nYour verification code is ${code}\nIt expires in ${minutes} minutes.\n\nEnter it on the sign-up screen to activate your account.\n\nIf you did not create this account you can ignore this email — the account stays locked without the code.`,
    html: shell({
      heading: 'Confirm your email',
      intro: `${escapeHtml(who)}enter this code on the sign-up screen to activate your AutoProp Scout Pro account.`,
      code,
      codeLabel: 'Verification code',
      outro: `This code expires in <b style="color:#f5f8fc">${minutes} minutes</b> and can only be used once.`,
      footnote: 'If you did not create this account, ignore this email. The account cannot be used until the code is entered.',
    }),
  };
}

export function passwordResetEmail({ code, displayName, minutes }) {
  const who = displayName ? `${displayName}, ` : '';
  return {
    subject: `${code} is your AutoProp password reset code`,
    text: `${who}we received a request to reset your AutoProp Scout Pro password.\n\nYour reset code is ${code}\nIt expires in ${minutes} minutes.\n\nIf you did not request this, ignore this email and your password stays unchanged.`,
    html: shell({
      heading: 'Reset your password',
      intro: `${escapeHtml(who)}use this code to set a new password on your AutoProp Scout Pro account.`,
      code,
      codeLabel: 'Reset code',
      outro: `This code expires in <b style="color:#f5f8fc">${minutes} minutes</b>. Resetting your password signs out every other device.`,
      footnote: 'If you did not request a reset, ignore this email — your password will not change.',
    }),
  };
}

export function welcomeEmail({ displayName, role }) {
  const who = displayName ? `${displayName}, ` : '';
  const roleLine = role === 'owner'
    ? 'You are the owner of this deployment, so you can manage the PickFinder connection and scan rules.'
    : 'You can run scans and review researched props. Connection and rule changes are limited to admins.';
  return {
    subject: 'Your AutoProp Scout Pro account is active',
    text: `${who}your email is confirmed and your AutoProp Scout Pro account is active.\n\n${roleLine}\n\nSecurity tips:\n- Use a unique password\n- Sign out of devices you no longer use from Account > Devices`,
    html: shell({
      heading: 'You are all set',
      intro: `${escapeHtml(who)}your email is confirmed and your account is active.`,
      outro: `${escapeHtml(roleLine)}<br /><br />You can review and revoke signed-in devices any time from <b style="color:#f5f8fc">Account → Devices</b>.`,
      footnote: 'You are receiving this because an AutoProp Scout Pro account was activated with this email address.',
    }),
  };
}

export function newDeviceEmail({ displayName, ip, userAgent, at }) {
  const who = displayName ? `${displayName}, ` : '';
  const context = contextLine({ ip, userAgent });
  return {
    subject: 'New sign-in to your AutoProp account',
    text: `${who}your AutoProp Scout Pro account was signed in from a new device.\n\n${context}\nAt ${at}\n\nIf this was you, no action is needed. If it was not, reset your password immediately — that signs out every device.`,
    html: shell({
      heading: 'New sign-in detected',
      intro: `${escapeHtml(who)}your account was just signed in from a device we have not seen before.`,
      outro: `<b style="color:#f5f8fc">${escapeHtml(context)}</b><br />${escapeHtml(at)}<br /><br />If this was not you, reset your password right away — a reset signs out every device.`,
      footnote: 'Security alerts are sent whenever a new device signs in to your account.',
    }),
  };
}

export function passwordChangedEmail({ displayName, at }) {
  const who = displayName ? `${displayName}, ` : '';
  return {
    subject: 'Your AutoProp password was changed',
    text: `${who}the password on your AutoProp Scout Pro account was changed at ${at}.\n\nEvery other signed-in device was signed out.\n\nIf you did not do this, reset your password immediately.`,
    html: shell({
      heading: 'Your password was changed',
      intro: `${escapeHtml(who)}the password on your account was changed at <b style="color:#f5f8fc">${escapeHtml(at)}</b>.`,
      outro: 'Every other signed-in device was signed out. If you did not make this change, reset your password immediately.',
      footnote: 'Security alerts are sent whenever your password changes.',
    }),
  };
}

export function existingAccountEmail({ displayName }) {
  const who = displayName ? `${displayName}, ` : '';
  return {
    subject: 'You already have an AutoProp account',
    text: `${who}someone just tried to create an AutoProp Scout Pro account with this email address, but you already have one.\n\nSign in with your existing password, or use "Forgot password" if you cannot remember it.\n\nNo new account was created and nothing changed on your account.`,
    html: shell({
      heading: 'You already have an account',
      intro: `${escapeHtml(who)}someone just tried to sign up with this email address, but an account already exists.`,
      outro: 'Sign in with your existing password, or use <b style="color:#f5f8fc">Forgot password</b> to set a new one. No new account was created.',
      footnote: 'If this was not you, no action is needed — nothing on your account changed.',
    }),
  };
}
