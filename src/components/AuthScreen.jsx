import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import CysicLogo from './CysicLogo.jsx';
import {
  DISPLAY_NAME_MAX,
  FIELD_LABEL,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_RE,
} from '../constants.js';
import { pickToken, translateFieldMessage } from '../session.js';

function authErrorMessage(err, isRegister) {
  if (err.status === 401) return isRegister ? '注册失败，请检查账号和密码。' : '账号或密码不对。';
  if (err.status === 409) return '这个账号已经被注册了，换一个或直接登录。';
  const fields = err.fields || {};
  const keys = Object.keys(fields);
  if (keys.length) {
    return keys.map((key) => `${FIELD_LABEL[key] || key}${translateFieldMessage(fields[key])}`).join('；') + '。';
  }
  return err.message || (isRegister ? '注册失败' : '登录失败');
}

export default function AuthScreen({ notice, onAuthenticated, onToast }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(notice || '');
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef(null);

  const isRegister = mode === 'register';

  useEffect(() => {
    usernameRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    setError(notice || '');
  }, [notice]);

  function switchMode(next) {
    setMode(next);
    setPassword('');
    setError('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const account = username.trim();
    const name = displayName.trim();

    setError('');
    if (!account) return setError('请输入账号。');
    if (isRegister) {
      if (account.length < USERNAME_MIN || account.length > USERNAME_MAX) {
        return setError(`账号需要 ${USERNAME_MIN}–${USERNAME_MAX} 个字符。`);
      }
      if (!USERNAME_RE.test(account)) return setError('账号只能包含字母、数字、点、短横线和下划线。');
    }
    if (!password) return setError(isRegister ? '请设置密码。' : '请输入密码。');
    if (isRegister && password.length < PASSWORD_MIN) return setError(`密码至少 ${PASSWORD_MIN} 位。`);
    if (password.length > PASSWORD_MAX) return setError(`密码最多 ${PASSWORD_MAX} 个字符。`);
    if (name.length > DISPLAY_NAME_MAX) return setError(`显示名最多 ${DISPLAY_NAME_MAX} 个字符。`);

    setBusy(true);
    try {
      if (isRegister) {
        const body = await api.register({
          username: account,
          password,
          display_name: name || account,
        });
        if (pickToken(body)) {
          onAuthenticated(body);
          onToast?.('账号已创建，已自动登录');
        } else {
          setMode('login');
          setUsername(account);
          setPassword('');
          setError('注册成功，请用刚才的账号登录。');
          onToast?.('注册成功');
        }
        return;
      }

      const body = await api.login({ username: account, password });
      if (!pickToken(body)) throw new Error('登录接口没有返回 token，等后端确认字段后再试。');
      onAuthenticated(body);
      onToast?.('已登录');
    } catch (err) {
      setError(authErrorMessage(err, isRegister));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="auth" className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <CysicLogo size={30} withWordmark />
          <span className="brand-divider" aria-hidden="true" />
          <p className="auth-eyebrow">团队任务台</p>
        </div>
        <h1 className="auth-title">{isRegister ? '注册' : '登录'}</h1>
        <p className="auth-sub">
          {isRegister ? '创建一个账号，之后用它登录看团队任务。' : '登录后查看团队任务、新建任务和推进状态。'}
        </p>

        <div className="auth-tabs" role="group" aria-label="登录或注册">
          <button
            className="auth-tab"
            type="button"
            aria-pressed={!isRegister}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            className="auth-tab"
            type="button"
            aria-pressed={isRegister}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        <form id="auth-form" onSubmit={handleSubmit} noValidate>
          {isRegister && (
            <div className="field" id="display-field">
              <div className="field-head">
                <label htmlFor="a-display">显示名</label>
              </div>
              <input
                id="a-display"
                name="display_name"
                type="text"
                maxLength={DISPLAY_NAME_MAX}
                placeholder="选填，默认用账号名"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
          )}

          <div className="field">
            <div className="field-head">
              <label htmlFor="a-username">账号</label>
            </div>
            <input
              id="a-username"
              name="username"
              type="text"
              maxLength={USERNAME_MAX}
              placeholder="3–32 位字母、数字或 _ . -"
              autoComplete="username"
              required
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="field">
            <div className="field-head">
              <label htmlFor="a-password">密码</label>
            </div>
            <input
              id="a-password"
              name="password"
              type="password"
              maxLength={PASSWORD_MAX}
              placeholder={isRegister ? `设置密码（至少 ${PASSWORD_MIN} 位）` : '密码'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p className="auth-error" id="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="btn primary auth-submit" type="submit" id="auth-submit" disabled={busy}>
            {busy ? (isRegister ? '注册中…' : '登录中…') : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <p className="auth-foot" id="auth-foot">
          {isRegister ? '已有账号？点上面的「登录」。' : '还没有账号？点上面的「注册」创建一个。'}
        </p>
      </div>
    </section>
  );
}

export { authErrorMessage };
