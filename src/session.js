import { AVATAR_COLORS, SESSION_KEY, STATUS_LABEL } from './constants.js';

/* ---------------- 本地存储 ---------------- */

export function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 登录态 ---------------- */

export function readSession() {
  const raw = readStorage(SESSION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  if (!token) return;
  writeStorage(SESSION_KEY, JSON.stringify({ token, user }));
}

export function clearSession() {
  removeStorage(SESSION_KEY);
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
