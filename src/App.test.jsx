import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { api } from './api.js';
import { createBackend } from './test/backend.js';

function setup(backend) {
  vi.stubGlobal('fetch', vi.fn(backend.handler));
  return {
    user: userEvent.setup(),
    ...render(<App />),
  };
}


function submitAuth() {
  return within(document.getElementById('auth-form')).getByRole('button', { name: /登录|注册/ });
}

async function login(user, username = 'bbsee', password = 'password123') {
  await screen.findByRole('heading', { name: '登录' });
  await user.type(screen.getByLabelText('账号'), username);
  await user.type(screen.getByLabelText('密码'), password);
  await user.click(submitAuth());
  await screen.findByRole('button', { name: '新建任务' });
}

describe('团队任务台（React）', () => {
  let backend;

  beforeEach(() => {
    backend = createBackend();
    localStorage.clear();
    sessionStorage.clear();
    api.setToken('');
    api.setUnauthorizedHandler(null);
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('未登录时只显示登录页', async () => {
    setup(backend);
    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建任务' })).not.toBeInTheDocument();
  });

  it('登录成功后加载任务列表和状态计数', async () => {
    const { user } = setup(backend);
    await login(user);

    expect(await screen.findByText('登录页联调')).toBeInTheDocument();
    expect(screen.getByText('80 端口静态挂载')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^全部/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /^待办/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /^进行中/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /^完成/ })).toHaveTextContent('1');
    expect(sessionStorage.getItem('ttb.session')).toContain('tok-bbsee');
  });

  it('密码错误时给出提示', async () => {
    const { user } = setup(backend);
    await screen.findByRole('heading', { name: '登录' });
    await user.type(screen.getByLabelText('账号'), 'bbsee');
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(submitAuth());

    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不对。');
  });

  it('注册时前端校验密码长度和账号格式', async () => {
    const { user } = setup(backend);
    await screen.findByRole('heading', { name: '登录' });
    await user.click(screen.getByRole('button', { name: '注册' }));

    await user.type(screen.getByLabelText('账号'), 'ab');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(submitAuth());
    expect(await screen.findByRole('alert')).toHaveTextContent('账号需要 3–32 个字符。');

    await user.clear(screen.getByLabelText('账号'));
    await user.type(screen.getByLabelText('账号'), 'newbie');
    await user.clear(screen.getByLabelText('密码'));
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.click(submitAuth());
    expect(await screen.findByRole('alert')).toHaveTextContent('密码至少 8 位。');
  });

  it('注册成功后自动登录并进入任务台', async () => {
    const { user } = setup(backend);
    await screen.findByRole('heading', { name: '登录' });
    await user.click(screen.getByRole('button', { name: '注册' }));
    await user.type(screen.getByLabelText('显示名'), '新同学');
    await user.type(screen.getByLabelText('账号'), 'newbie');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(submitAuth());

    expect(await screen.findByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByTitle('@newbie')).toHaveTextContent('新同学');
  });

  it('刷新页面时用已保存的登录态', async () => {
    sessionStorage.setItem(
      'ttb.session',
      JSON.stringify({ token: 'tok-bbsee', user: { id: 1, username: 'bbsee', displayName: 'BBSee', role: 'admin' } })
    );
    setup(backend);
    expect(await screen.findByText('登录页联调')).toBeInTheDocument();
    expect(screen.getByText('联调时注意旧会话的兼容。')).toBeInTheDocument();
  });

  it('token 失效时回到登录页并提示过期', async () => {
    sessionStorage.setItem('ttb.session', JSON.stringify({ token: 'tok-expired', user: { username: 'bbsee' } }));
    setup(backend);
    expect(await screen.findByRole('alert')).toHaveTextContent('登录已过期，请重新登录。');
    expect(sessionStorage.getItem('ttb.session')).toBeNull();
  });

  it('后端用户接口未上线时允许匿名浏览', async () => {
    backend.state.auth = '404';
    setup(backend);
    expect(await screen.findByText('登录页联调')).toBeInTheDocument();
    expect(screen.getByText(/用户系统接口/)).toBeInTheDocument();
    expect(screen.getByText('匿名访问')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
  });

  it('搜索先本地过滤，防抖后带 q 请求', async () => {
    const { user } = setup(backend);
    await login(user);

    const search = screen.getByLabelText(/搜索任务/);
    await user.type(search, '老周');

    expect(screen.getByText('80 端口静态挂载')).toBeInTheDocument();
    expect(screen.queryByText('登录页联调')).not.toBeInTheDocument();

    await waitFor(() => expect(backend.state.lastQuery).toBe('老周'), { timeout: 2000 });
  });

  it('「我负责的」只显示当前用户的任务', async () => {
    const { user } = setup(backend);
    await login(user);
    await user.click(screen.getByRole('button', { name: '我负责的' }));

    expect(screen.getByText('登录页联调')).toBeInTheDocument();
    expect(screen.queryByText('80 端口静态挂载')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我负责的' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('点状态按钮推进任务状态', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '「80 端口静态挂载」当前待办，改为进行中' }));

    await waitFor(() => {
      expect(backend.tasks.find((task) => task.id === 2).status).toBe('doing');
    });
    expect(
      await screen.findByRole('button', { name: '「80 端口静态挂载」当前进行中，改为完成' })
    ).toBeInTheDocument();
  });

  it('新建任务：负责人默认自己，创建后出现在列表', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('负责人')).toHaveValue('BBSee');

    await user.type(within(dialog).getByLabelText('标题'), '把 React 版联调做完');
    await user.click(within(dialog).getByRole('radio', { name: '高' }));
    await user.click(within(dialog).getByRole('button', { name: '新建任务' }));

    expect(await screen.findByText('把 React 版联调做完')).toBeInTheDocument();
    expect(backend.tasks[0]).toMatchObject({ title: '把 React 版联调做完', assignee: 'BBSee', priority: 'high' });
  });

  it('新建任务时校验标题不能为空', async () => {
    const { user } = setup(backend);
    await login(user);
    await user.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '新建任务' }));

    expect(await within(dialog).findByText('标题不能为空')).toBeInTheDocument();
    expect(backend.tasks).toHaveLength(3);
  });

  it('新建任务时可以带备注提交', async () => {
    const { user } = setup(backend);
    await login(user);
    await user.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = await screen.findByRole('dialog');
    const noteInput = within(dialog).getByLabelText(/备注/);
    expect(noteInput).toHaveAttribute('maxLength', '200');

    await user.type(within(dialog).getByLabelText('标题'), '带备注的任务');
    await user.type(noteInput, '先确认旧接口兼容');
    await user.click(within(dialog).getByRole('button', { name: '新建任务' }));

    await waitFor(() => expect(backend.tasks[0].note).toBe('先确认旧接口兼容'));
    expect(backend.tasks[0].title).toBe('带备注的任务');
  });

  it('备注没填时不提交 note 字段', async () => {
    const { user } = setup(backend);
    await login(user);
    await user.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('标题'), '没有备注的任务');
    await user.click(within(dialog).getByRole('button', { name: '新建任务' }));

    await waitFor(() => expect(backend.tasks[0].title).toBe('没有备注的任务'));
    const posted = backend.state.calls.find((call) => call.method === 'POST' && call.path === '/api/tasks');
    expect(posted.body).not.toHaveProperty('note');
    expect(backend.tasks[0]).not.toHaveProperty('note');
  });

  it('任务详情显示备注', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '打开任务「登录页联调」' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('联调时注意旧会话的兼容。')).toBeInTheDocument();
  });

  it('详情里编辑标题并保存', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '打开任务「80 端口静态挂载」' }));
    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getByLabelText('标题');
    await user.clear(titleInput);
    await user.type(titleInput, '80 端口静态挂载（已验证）');
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(backend.tasks.find((task) => task.id === 2).title).toBe('80 端口静态挂载（已验证）');
    });
    expect(await screen.findByText('80 端口静态挂载（已验证）')).toBeInTheDocument();
  });

  it('一键指派给我', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '打开任务「80 端口静态挂载」' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '指派给我' }));

    await waitFor(() => {
      expect(backend.tasks.find((task) => task.id === 2).assignee).toBe('BBSee');
    });
    expect(within(dialog).getByLabelText('负责人')).toHaveValue('BBSee');
  });

  it('讨论区加载并发送评论', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '打开任务「登录页联调」' }));
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText('字段我这边按 q 做。')).toBeInTheDocument();
    const input = within(dialog).getByPlaceholderText(/写点进展/);
    await user.type(input, 'Swagger 已核对完{Enter}');

    expect(await within(dialog).findByText('Swagger 已核对完')).toBeInTheDocument();
    expect(backend.comments[1]).toHaveLength(2);
  });

  it('删除任务需要二次确认', async () => {
    const { user } = setup(backend);
    await login(user);

    await user.click(screen.getByRole('button', { name: '打开任务「80 端口静态挂载」' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除任务' }));
    await user.click(within(dialog).getByRole('button', { name: '确认删除？' }));

    await waitFor(() => expect(backend.tasks.some((task) => task.id === 2)).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('80 端口静态挂载')).not.toBeInTheDocument();
  });

  it('不是创建人时看不到删除按钮（管理员除外）', async () => {
    const { user } = setup(backend);
    await login(user, 'zhou');
    await user.click(screen.getByRole('button', { name: '打开任务「登录页联调」' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /删除任务/ })).not.toBeInTheDocument();
  });

  it('接口报错时显示错误面板，可重试', async () => {
    backend.state.taskMode = 'error';
    const { user } = setup(backend);
    await login(user);

    expect(await screen.findByText('接口连不上')).toBeInTheDocument();
    backend.state.taskMode = 'ok';
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('登录页联调')).toBeInTheDocument();
  });

  it('退出登录后清掉本地登录态', async () => {
    sessionStorage.setItem(
      'ttb.session',
      JSON.stringify({ token: 'tok-bbsee', user: { id: 1, username: 'bbsee', displayName: 'BBSee', role: 'admin' } })
    );
    const { user } = setup(backend);
    await screen.findByRole('button', { name: '新建任务' });
    await user.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(sessionStorage.getItem('ttb.session')).toBeNull();
  });

  it('任务接口 401 时自动回登录页', async () => {
    const custom = createBackend({
      handler: ({ path, method }) => {
        if (path === '/api/tasks' && method === 'GET') {
          return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'expired' } }) };
        }
        return null;
      },
    });
    const { user } = setup(custom);
    await screen.findByRole('heading', { name: '登录' });
    await user.type(screen.getByLabelText('账号'), 'bbsee');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(submitAuth());

    expect(await screen.findByRole('alert')).toHaveTextContent('登录已过期，请重新登录');
  });
});
