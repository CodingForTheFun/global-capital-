const ACCOUNT_IMPORT = "import { handleAccountRoutes, currentAccount, mailStatus } from './lib/auth/routes.mjs';";
const AVATAR_IMPORT = "import { handleProfileAvatarRoute } from './lib/auth/avatar-routes.mjs';";
const ACCOUNT_CALL = "if (await handleAccountRoutes(req, res, url, { sessions: accountSessions, json: directJson, secret: sessionSecret })) return true;";
const AVATAR_CALL = "if (await handleProfileAvatarRoute(req, res, url, { sessions: accountSessions, secret: sessionSecret })) return true;";

export function patchProfileAvatarFrontdoor(source) {
  const input = String(source || '');
  if (input.includes(AVATAR_IMPORT) && input.includes(AVATAR_CALL)) return input;
  if (!input.includes(ACCOUNT_IMPORT)) throw new Error('Profile avatar patch could not locate the account route import.');
  if (!input.includes(ACCOUNT_CALL)) throw new Error('Profile avatar patch could not locate the account route mount.');

  return input
    .replace(ACCOUNT_IMPORT, `${ACCOUNT_IMPORT}\n${AVATAR_IMPORT}`)
    .replace(ACCOUNT_CALL, `${AVATAR_CALL}\n    ${ACCOUNT_CALL}`);
}
