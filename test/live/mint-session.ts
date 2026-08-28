import { QueraClient } from "../../src/api/queraClient";
(async () => {
  const c = new QueraClient({
    baseUrl: "https://quera.org/",
    username: process.env.QP_USER, password: process.env.QP_PASS, locale: "fa",
  });
  await c.login();
  const me = await c.whoami();
  if (!c.sessionId || !me?.username) { console.error("login did not establish a session"); process.exit(1); }
  process.stderr.write(`signed in as ${me.username}\n`);
  process.stdout.write(String(c.sessionId));
})().catch((e) => { console.error("FAILED:", e?.message || e); process.exit(1); });
