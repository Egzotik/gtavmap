/* Minimap backend: Discord OAuth + sessions + cabinet API.
 * No dependencies, Web APIs only. Static site is served via ASSETS binding.
 *
 * Required bindings/vars (wrangler.jsonc):
 *   DB (d1), ASSETS, DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI,
 *   secret DISCORD_CLIENT_SECRET
 */

const SESSION_COOKIE = 'mapedit_session';
const STATE_COOKIE = 'oauth_state';
const SESSION_DAYS = 30;

function parseCookies(req) {
  const out = {};
  const header = req.headers.get('cookie');
  if (!header) return out;
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setCookie(name, value, opts = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}`;
  if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (opts.secure !== false) s += '; Secure';
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  return s;
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(url, cookies = []) {
  const headers = new Headers({ Location: url });
  cookies.forEach(c => headers.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers });
}

function json(data, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  cookies.forEach(c => headers.append('Set-Cookie', c));
  return new Response(JSON.stringify(data), { status, headers });
}

async function sha256hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nowIso() {
  return new Date().toISOString();
}

async function getSessionUser(env, req) {
  if (!env.DB) return null;
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256hex(token);
  let row;
  try {
    row = await env.DB.prepare(
      `SELECT u.id, u.username, u.avatar, u.role, u.guild_roles,
              u.access_token, u.refresh_token, u.token_expires_at, u.role_checked_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    ).bind(hash).first();
  } catch (e) {
    try {
      row = await env.DB.prepare(
        `SELECT u.id, u.username, u.avatar, u.role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      ).bind(hash).first();
    } catch (e2) {
      return null;
    }
  }
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run().catch(() => {});
    return null;
  }
  const user = { id: row.id, username: row.username, avatar: row.avatar, role: row.role, guildRoles: [] };
  try { user.guildRoles = row.guild_roles ? JSON.parse(row.guild_roles) : []; } catch (e) {}
  // Ленивое обновление роли (не чаще раза в 10 минут): токен -> роли -> роль сайта.
  // Любая ошибка = остаёмся на старой роли, сессия валидна.
  try {
    const checkedAt = row.role_checked_at ? new Date(row.role_checked_at).getTime() : 0;
    if (Date.now() - checkedAt > 10 * 60 * 1000 && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.GUILD_ID) {
      let access = row.access_token;
      if (!access || (row.token_expires_at && new Date(row.token_expires_at).getTime() - Date.now() < 60000)) {
        if (!row.refresh_token) throw new Error('no refresh token');
        const params = new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: row.refresh_token
        });
        const tokRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });
        if (!tokRes.ok) throw new Error('refresh http ' + tokRes.status);
        const tok = await tokRes.json();
        access = tok.access_token;
        const tokExp = new Date(Date.now() + (tok.expires_in || 604800) * 1000).toISOString();
        await env.DB.prepare(
          'UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?'
        ).bind(access, tok.refresh_token || row.refresh_token, tokExp, row.id).run();
      }
      const membership = await fetchGuildMember(access, 'Bearer', env.GUILD_ID);
      const freshRole = siteRoleFor(membership.roles, env);
      try {
        await env.DB.prepare(
          'UPDATE users SET role = ?, guild_roles = ?, role_checked_at = ? WHERE id = ?'
        ).bind(freshRole, JSON.stringify(membership.roles), nowIso(), row.id).run();
      } catch (e) { /* migration 0002/0003 not applied yet */ }
      user.role = freshRole;
      user.guildRoles = membership.roles;
    }
  } catch (e) { /* stale role is fine, session stays valid */ }
  return user;
}

const ROLE_NAMES = { user: 'Пользователь', moderator: 'Модератор', admin: 'Администратор' };

function parseRoleList(value) {
  return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Роль сайта выводится из ролей Discord при каждом входе:
// есть админская роль → admin, иначе user. SITE_ROLE_IDS — для будущих gating-правил.
function siteRoleFor(guildRoles, env) {
  const adminIds = parseRoleList(env.ADMIN_ROLE_IDS);
  if (adminIds.length > 0 && guildRoles.some(r => adminIds.includes(r))) return 'admin';
  return 'user';
}

async function fetchGuildMember(accessToken, tokenType, guildId) {
  if (!guildId) return { roles: [], member: false };
  try {
    const res = await fetch(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `${tokenType} ${accessToken}` }
    });
    if (!res.ok) return { roles: [], member: false };
    const member = await res.json();
    return { roles: Array.isArray(member.roles) ? member.roles.map(String) : [], member: true };
  } catch (e) {
    return { roles: [], member: false };
  }
}

function loginRedirect(env) {
  const state = crypto.randomUUID();
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');
  url.searchParams.set('state', state);
  return redirect(url.toString(), [setCookie(STATE_COOKIE, state, { maxAge: 600 })]);
}

async function oauthCallback(env, req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req);
  if (!code || !state || cookies[STATE_COOKIE] !== state) {
    return redirect('/cabinet/?error=state', [clearCookie(STATE_COOKIE)]);
  }
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.DISCORD_REDIRECT_URI
  });
  let token;
  try {
    const tokRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    if (!tokRes.ok) throw new Error('token http ' + tokRes.status);
    token = await tokRes.json();
  } catch (e) {
    return redirect('/cabinet/?error=exchange', [clearCookie(STATE_COOKIE)]);
  }
  let me;
  try {
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `${token.token_type} ${token.access_token}` }
    });
    if (!meRes.ok) throw new Error('profile http ' + meRes.status);
    me = await meRes.json();
  } catch (e) {
    return redirect('/cabinet/?error=profile', [clearCookie(STATE_COOKIE)]);
  }
  // Роль выводится из ролей Discord на сервере при каждом входе.
  const membership = await fetchGuildMember(token.access_token, token.token_type, env.GUILD_ID);
  const role = siteRoleFor(membership.roles, env);
  const isMember = membership.member;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO users (id, username, avatar, role) VALUES (?, ?, ?, ?)'
    ).bind(me.id, me.username, me.avatar || null, role),
    env.DB.prepare(
      `UPDATE users SET username = ?, avatar = ?, role = ?, last_login_at = ?, updated_at = ? WHERE id = ?`
    ).bind(me.username, me.avatar || null, role, nowIso(), nowIso(), me.id)
  ]);
  try {
    await env.DB.prepare('UPDATE users SET guild_roles = ? WHERE id = ?').bind(JSON.stringify(membership.roles), me.id).run();
  } catch (e) { /* migration 0002 not applied yet */ }
  const tokenExpiresAt = new Date(Date.now() + (token.expires_in || 604800) * 1000).toISOString();
  try {
    await env.DB.prepare(
      'UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ?, role_checked_at = ? WHERE id = ?'
    ).bind(token.access_token, token.refresh_token || null, tokenExpiresAt, nowIso(), me.id).run();
  } catch (e) { /* migration 0003 not applied yet */ }
  const sessionToken = crypto.randomUUID();
  const hash = await sha256hex(sessionToken);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(hash, me.id, expires).run();
  return redirect('/cabinet/', [
    clearCookie(STATE_COOKIE),
    setCookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_DAYS * 24 * 3600 })
  ]);
}

async function logout(env, req) {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE] && env.DB) {
    const hash = await sha256hex(cookies[SESSION_COOKIE]);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run().catch(() => {});
  }
  return redirect('/', [clearCookie(SESSION_COOKIE)]);
}

// Сверка ролей всех известных пользователей со списком участников сервера.
// Вызывается CRONом каждые 5 минут и вручную через /api/admin/reconcile.
// Покинувшие сервер опускаются до user только при полном обходе списка.
async function reconcileGuildRoles(env) {
  if (!env.DISCORD_BOT_TOKEN || !env.GUILD_ID || !env.DB) {
    return { ok: false, reason: 'not_configured' };
  }
  const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` };
  const members = new Map();
  let after = '0';
  let complete = false;
  for (let page = 0; page < 20; page++) {
    const res = await fetch(
      `https://discord.com/api/guilds/${env.GUILD_ID}/members?limit=1000&after=${after}`,
      { headers }
    );
    if (res.status === 429) return { ok: false, reason: 'rate_limited' };
    if (!res.ok) return { ok: false, reason: 'http ' + res.status };
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) { complete = true; break; }
    list.forEach(mb => {
      if (mb.user) members.set(String(mb.user.id), (mb.roles || []).map(String));
    });
    if (list.length < 1000) { complete = true; break; }
    after = String(list[list.length - 1].user.id);
  }
  const users = await env.DB.prepare('SELECT id, role FROM users').all();
  const stmts = [];
  let updated = 0;
  for (const u of (users.results || [])) {
    const roles = members.get(String(u.id));
    if (roles === undefined && !complete) continue;
    const freshRole = roles === undefined ? 'user' : siteRoleFor(roles, env);
    stmts.push(
      env.DB.prepare('UPDATE users SET role = ?, guild_roles = ?, role_checked_at = ? WHERE id = ?')
        .bind(freshRole, JSON.stringify(roles || []), nowIso(), u.id)
    );
    updated++;
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  return { ok: true, checked: (users.results || []).length, updated, complete };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/auth/login') {
      if (!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI) {
        return json({ error: 'oauth_not_configured' }, 503);
      }
      return loginRedirect(env);
    }

    if (path === '/api/auth/callback') {
      if (!env.DB || !env.DISCORD_CLIENT_SECRET) {
        return redirect('/cabinet/?error=config');
      }
      try {
        return await oauthCallback(env, req);
      } catch (e) {
        return redirect('/cabinet/?error=internal');
      }
    }

    if (path === '/api/auth/logout') {
      try {
        return await logout(env, req);
      } catch (e) {
        return redirect('/', [clearCookie(SESSION_COOKIE)]);
      }
    }

    if (path === '/api/me') {
      try {
        const user = await getSessionUser(env, req);
        if (!user) return json({ user: null }, 401);
        user.roleName = ROLE_NAMES[user.role] || user.role;
        return json({ user });
      } catch (e) {
        return json({ user: null }, 401);
      }
    }

    if (path === '/api/admin/reconcile') {
      try {
        const user = await getSessionUser(env, req);
        if (!user || user.role !== 'admin') return json({ error: 'forbidden' }, 403);
        return json(await reconcileGuildRoles(env));
      } catch (e) {
        return json({ ok: false, reason: 'internal' }, 500);
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('assets binding missing', { status: 500 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcileGuildRoles(env).catch(() => {}));
  }
};
