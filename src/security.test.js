import { describe, it, expect, beforeEach } from 'vitest';
import { resolveApiBase, sanitizeApiBase, isLocalLocation } from './api.js';
import { readSession, saveSession, clearSession, purgeLegacyStorage } from './session.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const prod = { protocol: 'https:', hostname: 'tasks.example.com', origin: 'https://tasks.example.com', search: '' };
const local = { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:8790', search: '' };

describe('接口地址（防凭据钓鱼）', () => {
  it('线上忽略 ?api= 覆盖，只走同源 /api', () => {
    const storage = fakeStorage({ 'ttb.apiBase': 'https://evil.example' });
    const loc = { ...prod, search: '?api=https://evil.example' };
    expect(resolveApiBase(loc, storage)).toBe('');
    expect(storage.data['ttb.apiBase']).toBeUndefined();
  });

  it('线上清掉历史遗留的接口地址记录', () => {
    const storage = fakeStorage({ 'ttb.apiBase': 'https://evil.example' });
    resolveApiBase(prod, storage);
    expect(storage.data['ttb.apiBase']).toBeUndefined();
  });

  it('本地开发仍可用 ?api= 指向测试服', () => {
    const loc = { ...local, search: '?api=http://127.0.0.1:8791/' };
    expect(resolveApiBase(loc, fakeStorage())).toBe('http://127.0.0.1:8791');
  });

  it('本地没有覆盖时连测试服', () => {
    expect(resolveApiBase(local, fakeStorage())).toBe('http://47.108.60.176');
  });

  it('只接受 http(s) 且不带凭据的地址', () => {
    expect(sanitizeApiBase('javascript:alert(1)')).toBe('');
    expect(sanitizeApiBase('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeApiBase('https://user:pass@evil.example')).toBe('');
    expect(sanitizeApiBase('http://47.108.60.176///')).toBe('http://47.108.60.176');
    expect(sanitizeApiBase(null)).toBe('');
  });

  it('识别本地地址', () => {
    expect(isLocalLocation(local)).toBe(true);
    expect(isLocalLocation({ ...prod, hostname: 'localhost' })).toBe(true);
    expect(isLocalLocation(prod)).toBe(false);
  });
});

describe('登录态存储', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('token 存在 sessionStorage，不落 localStorage', () => {
    saveSession('tok-1', { username: 'bbsee' });
    expect(sessionStorage.getItem('ttb.session')).toContain('tok-1');
    expect(localStorage.getItem('ttb.session')).toBeNull();
  });

  it('读取时清掉旧版本留在 localStorage 里的 token', () => {
    localStorage.setItem('ttb.session', JSON.stringify({ token: 'old-token' }));
    localStorage.setItem('ttb.apiBase', 'https://evil.example');
    saveSession('tok-1', { username: 'bbsee' });

    expect(readSession()).toMatchObject({ token: 'tok-1' });
    expect(localStorage.getItem('ttb.session')).toBeNull();
    expect(localStorage.getItem('ttb.apiBase')).toBeNull();
  });

  it('拒绝畸形或超长 token', () => {
    sessionStorage.setItem('ttb.session', JSON.stringify({ token: 42 }));
    expect(readSession()).toBeNull();

    sessionStorage.setItem('ttb.session', JSON.stringify({ token: 'x'.repeat(5000) }));
    expect(readSession()).toBeNull();
    expect(sessionStorage.getItem('ttb.session')).toBeNull();
  });

  it('退出时清掉两个存储里的会话', () => {
    saveSession('tok-1', { username: 'bbsee' });
    localStorage.setItem('ttb.session', '{"token":"old"}');
    clearSession();

    expect(sessionStorage.getItem('ttb.session')).toBeNull();
    expect(localStorage.getItem('ttb.session')).toBeNull();
    purgeLegacyStorage();
  });
});
