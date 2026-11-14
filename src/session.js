import { API_BASE_KEY, AVATAR_COLORS, SESSION_KEY, STATUS_LABEL } from './constants.js';

/* ---------------- 会话存储 ----------------
 * 登录 token 放在 sessionStorage：只在当前标签页有效，刷新还在、关标签页就没了，
 * 也不和执行同源脚本的其它页面共享，比长期留在 localStorage 里安全。
 * 后端如果以后改成 HttpOnly Cookie，这里可以直接删掉。
 */

const TOKEN_MAX = 4096;

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    storage()?.setItem(key, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function removeStorage(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/* 清掉旧版本留在 localStorage 里的 token 和接口地址，避免它们长期留在磁盘上 */
export function purgeLegacyStorage() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(API_BASE_KEY);
  } catch {
    /* 隐私模式 / 禁用存储时忽略 */
  }
}

/* ---------------- 登录态 ---------------- */

export function readSession() {
  purgeLegacyStorage();
  const raw = readStorage(SESSION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return null;
    const token = typeof saved.token === 'string' ? saved.token.trim() : '';
    if (!token || token.length > TOKEN_MAX) {
      removeStorage(SESSION_KEY);
      return null;
    }
    return {
      token,
      user: saved.user && typeof saved.user === 'object' ? saved.user : null,
    };
  } catch {
    removeStorage(SESSION_KEY);
    return null;
  }
}

export function saveSession(token, user) {
  if (!token || typeof token !== 'string' || token.length > TOKEN_MAX) return;
  writeStorage(SESSION_KEY, JSON.stringify({ token, user: user || null }));
}

export function clearSession() {
  removeStorage(SESSION_KEY);
  purgeLegacyStorage();
}

/* ---------------- 取值兼容 ---------------- */

export function unwrap(body) {
  if (!body || typeof body !== 'object') return null;
  return body.data && typeof body.data === 'object' ? body.data : body;
}

export function pickToken(body) {
  const data = unwrap(body) || {};
  const root = body && typeof body === 'object' ? body : {};
  return data.token || data.access_token || data.accessToken || root.token || root.access_token || '';
}

export function pickUser(body) {
  if (!body || typeof body !== 'object') return null;
  const data = unwrap(body);
  if (!data) return null;
  const raw = data.user && typeof data.user === 'object' ? data.user : data;
  const username = String(raw.username || raw.account || raw.name || '').trim();
  const displayName = String(raw.display_name || raw.displayName || raw.nickname || username).trim();
  if (!username && !displayName) return null;
  return {
    id: raw.id ?? null,
    username: username || displayName,
    displayName: displayName || username,
    role: raw.role || 'member',
  };
}

export function extractItems(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.items)) return body.items;
  if (body && body.data) return extractItems(body.data);
  return [];
}

/* ---------------- 格式化 ---------------- */

export function avatarColor(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function relativeTime(iso) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(time));
}

export function fullTime(iso) {
  const time = new Date(iso);
  return Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
    : '';
}

export function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
}

export function translateFieldMessage(message) {
  const text = String(message || '');
  if (text === 'is required' || text === 'must not be empty') return '不能为空';
  if (text === 'is already taken') return '已经被注册了';
  if (text === 'must be a string') return '格式不对';
  if (text.startsWith('may only contain')) return '只能包含字母、数字、点、短横线和下划线';
  let match = text.match(/^must be at least (\d+) characters$/);
  if (match) return `至少 ${match[1]} 个字符`;
  match = text.match(/^must be at most (\d+) characters$/);
  if (match) return `最多 ${match[1]} 个字符`;
  return text;
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || status;
}
