// Import explicitly selected, domain-scoped cookies into an already running page.
import { findSiteSessions } from '../js/src/index.js';

export async function reuseSiteSession(
  commander,
  { domains, sources, isLoggedIn }
) {
  const sessions = await findSiteSessions({ domains, sources, isLoggedIn });
  const session = sessions.find((candidate) => candidate.loggedIn === true);
  if (!session) return { reused: false, sessions };
  await commander.setCookies(session.cookies);
  return { reused: true, source: session, sessions };
}
