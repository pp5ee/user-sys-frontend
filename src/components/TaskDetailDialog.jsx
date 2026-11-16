import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  ASSIGNEE_MAX,
  COMMENT_MAX,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TITLE_MAX,
} from '../constants.js';
import { avatarColor, extractItems, fullTime, relativeTime, translateFieldMessage } from '../session.js';

const emptyErrors = { title: '', assignee: '' };

function extractComments(body) {
  const items = extractItems(body);
  if (items.length) return items;
  if (body && body.comment && typeof body.comment === 'object') return [body.comment];
  return [];
}

function commentAuthor(comment) {
  const source = comment && comment.user && typeof comment.user === 'object' ? comment.user : comment;
  const name = String(
    source.display_name || source.displayName || source.username || comment?.display_name || comment?.username || '成员'
  ).trim();
  return {
    name: name || '成员',
    username: String(source.username || comment?.username || '').trim(),
  };
}

function commentText(comment) {
  return String(comment?.content ?? comment?.body ?? comment?.text ?? '').trim();
}

export default function TaskDetailDialog({
  task,
  signedIn,
  canDelete,
  assigneeOptions,
  onClose,
  onSave,
  onAssignMe,
  onDelete,
  onCopyLink,
  onToast,
}) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const assigneeRef = useRef(null);
  const deleteTimer = useRef(0);
  const closedRef = useRef(false);

  const [title, setTitle] = useState(task.title || '');
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [priority, setPriority] = useState(task.priority || 'medium');
  const [status, setStatus] = useState(task.status || 'todo');
  const [errors, setErrors] = useState(emptyErrors);
  const [saving, setSaving] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [comments, setComments] = useState({ status: 'idle', items: [], message: '' });
  const [commentText2, setCommentText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    dialog.classList.add('is-open');
    titleRef.current?.focus();
  }, []);

  /* ---- 讨论区加载 ---- */
  useEffect(() => {
    if (!signedIn) {
      setComments({ status: 'login', items: [], message: '' });
      return undefined;
    }
    let cancelled = false;
    setComments({ status: 'loading', items: [], message: '' });
    api
      .comments(task.id)
      .then((data) => {
        if (cancelled) return;
        setComments({ status: 'ready', items: extractComments(data), message: '' });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.status === 401 || err.status === 403) return;
        if (err.status === 404 || err.status === 405 || err.status === 501) {
          setComments({ status: 'unavailable', items: [], message: '' });
          return;
        }
        setComments({ status: 'error', items: [], message: err.message || '未知错误' });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, signedIn]);

  useEffect(() => () => window.clearTimeout(deleteTimer.current), []);

  function finish() {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }

  function close() {
    window.clearTimeout(deleteTimer.current);
    const dialog = dialogRef.current;
    dialog?.classList.remove('is-open');
    if (dialog && typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog?.removeAttribute('open');
    finish();
  }

  function validate() {
    const value = title.trim();
    const owner = assignee.trim();
    const next = { title: '', assignee: '' };
    let valid = true;

    if (!value) {
      next.title = '标题不能为空';
      valid = false;
    } else if (value.length > TASK_TITLE_MAX) {
      next.title = `标题最多 ${TASK_TITLE_MAX} 字`;
      valid = false;
    }

    if (!owner) {
      next.assignee = '负责人不能为空';
      valid = false;
    } else if (owner.length > ASSIGNEE_MAX) {
      next.assignee = `负责人最多 ${ASSIGNEE_MAX} 字`;
      valid = false;
    }

    setErrors(next);
    if (!valid) {
      (!value ? titleRef : assigneeRef).current?.focus();
      return null;
    }
    return { title: value, assignee: owner };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;

    const values = validate();
    if (!values) return;

    const payload = {};
    if (values.title !== task.title) payload.title = values.title;
    if (values.assignee !== task.assignee) payload.assignee = values.assignee;
    if (priority !== task.priority) payload.priority = priority;
    if (status !== task.status) payload.status = status;

    if (!Object.keys(payload).length) {
      close();
      onToast?.('没有改动');
      return;
    }

    setSaving(true);
    try {
      await onSave(payload);
      close();
    } catch (err) {
      if (err.status === 401) {
        close();
        return;
      }
      if (err.status === 404) {
        close();
        onToast?.('这条任务已经被删除了', 'error');
        return;
      }
      if (err.status === 403) {
        onToast?.(err.message || '没有权限修改这条任务', 'error');
        return;
      }
      const fields = err.fields || {};
      if (fields.title || fields.assignee) {
        setErrors({
          title: fields.title ? translateFieldMessage(fields.title) : '',
          assignee: fields.assignee ? translateFieldMessage(fields.assignee) : '',
        });
        onToast?.('请检查填写内容', 'error');
      } else {
        onToast?.(err.message || '保存失败', 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignMe() {
    try {
      const applied = await onAssignMe();
      if (applied) {
        setAssignee(applied);
        setErrors((prev) => ({ ...prev, assignee: '' }));
      }
    } catch {
      /* 父组件已经提示过 */
    }
  }

  async function handleDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.clearTimeout(deleteTimer.current);
      deleteTimer.current = window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    window.clearTimeout(deleteTimer.current);
    setDeleteArmed(false);
    setDeleting(true);
    try {
      await onDelete();
      close();
    } catch {
      /* 父组件已经提示过，弹窗保持打开 */
    } finally {
      setDeleting(false);
    }
  }

  async function sendComment() {
    const content = commentText2.trim();
    if (!content || comments.status !== 'ready' || sending) return;
    if (content.length > COMMENT_MAX) {
      onToast?.(`留言最多 ${COMMENT_MAX} 字`, 'error');
      return;
    }

    setSending(true);
    try {
      const data = await api.addComment(task.id, content);
      const saved = data && typeof data === 'object' ? data.comment || data.item || data : null;
      if (saved && (saved.id || saved.content || saved.body)) {
        setComments((prev) => ({ ...prev, items: [...prev.items, saved] }));
      } else {
        const fresh = await api.comments(task.id);
        setComments({ status: 'ready', items: extractComments(fresh), message: '' });
      }
      setCommentText('');
    } catch (err) {
      if (err.status === 401) return;
      if (err.status === 404 || err.status === 405 || err.status === 501) {
        setComments((prev) => ({ ...prev, status: 'unavailable' }));
        onToast?.('评论接口还没上线，等后端接入后再试', 'error');
        return;
      }
      const fields = err.fields || {};
      onToast?.(fields.content ? `留言${translateFieldMessage(fields.content)}` : err.message || '发送失败', 'error');
    } finally {
      setSending(false);
    }
  }

  const creator = task.creator ? `由 ${task.creator} 创建` : '创建人未知';
  const updated = task.updated_at ? `更新于 ${relativeTime(task.updated_at)}` : '';
  const note = typeof task.note === 'string' ? task.note.trim() : '';
  const commentLabel = comments.items.length ? `${comments.items.length} 条` : comments.status === 'loading' ? '…' : '';

  return (
    <dialog
      id="detail-dialog"
      className="dialog detail"
      ref={dialogRef}
      onClose={finish}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.target?.tagName === 'TEXTAREA') {
          event.stopPropagation();
          event.target.blur();
        }
      }}
    >
      <form id="detail-form" onSubmit={handleSubmit} noValidate>
        <header className="dialog-head">
          <div>
            <p className="detail-eyebrow">任务 #{task.id}</p>
            <h2>{task.title || '任务详情'}</h2>
          </div>
          <button type="button" className="icon-btn" id="detail-close" aria-label="关闭" onClick={close}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>

        <div className="field">
          <div className="field-head">
            <label htmlFor="d-title">标题</label>
            <span className="counter">{title.length}/{TASK_TITLE_MAX}</span>
          </div>
          <input
            id="d-title"
            type="text"
            maxLength={TASK_TITLE_MAX}
            autoComplete="off"
            required
            ref={titleRef}
            value={title}
            aria-invalid={errors.title ? 'true' : 'false'}
            onChange={(event) => {
              setTitle(event.target.value);
              if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
            }}
          />
          {errors.title ? (
            <p className="field-error" id="d-title-error">
              {errors.title}
            </p>
          ) : null}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="d-assignee">负责人</label>
            {signedIn ? (
              <button type="button" className="text-btn" id="assign-me" onClick={handleAssignMe}>
                指派给我
              </button>
            ) : null}
          </div>
          <input
            id="d-assignee"
            type="text"
            maxLength={ASSIGNEE_MAX}
            list="assignee-options"
            autoComplete="off"
            required
            ref={assigneeRef}
            value={assignee}
            aria-invalid={errors.assignee ? 'true' : 'false'}
            onChange={(event) => {
              setAssignee(event.target.value);
              if (errors.assignee) setErrors((prev) => ({ ...prev, assignee: '' }));
            }}
          />
          {errors.assignee ? (
            <p className="field-error" id="d-assignee-error">
              {errors.assignee}
            </p>
          ) : null}
        </div>

        <div className="field-row">
          <div className="field">
            <div className="field-head">
              <span className="label-like" id="d-priority-label">
                优先级
              </span>
            </div>
            <div className="segmented" role="radiogroup" aria-labelledby="d-priority-label">
              {['low', 'medium', 'high'].map((value) => (
                <label className="seg" key={value}>
                  <input
                    type="radio"
                    name="d-priority"
                    value={value}
                    checked={priority === value}
                    onChange={() => setPriority(value)}
                  />
                  <span>{PRIORITY_LABEL[value]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <div className="field-head">
              <span className="label-like" id="d-status-label">
                状态
              </span>
            </div>
            <div className="segmented" role="radiogroup" aria-labelledby="d-status-label">
              {['todo', 'doing', 'done'].map((value) => (
                <label className="seg" key={value}>
                  <input
                    type="radio"
                    name="d-status"
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                  />
                  <span>{STATUS_LABEL[value]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {note ? (
          <div className="detail-note">
            <span className="detail-note-label">备注</span>
            <p className="detail-note-text">{note}</p>
          </div>
        ) : null}

        <div className="detail-meta">
          <span title={task.updated_at ? fullTime(task.updated_at) : ''}>
            {[creator, updated].filter(Boolean).join(' · ')}
          </span>
          <button type="button" className="text-btn" id="detail-copy" onClick={onCopyLink}>
            复制链接
          </button>
        </div>

        <footer className="dialog-actions">
          {canDelete ? (
            <button
              type="button"
              className={`btn ghost danger${deleteArmed ? ' is-armed' : ''}`}
              id="detail-delete"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? '删除中…' : deleteArmed ? '确认删除？' : '删除任务'}
            </button>
          ) : null}
          <span className="actions-spacer" />
          <button type="button" className="btn ghost" id="detail-cancel" onClick={close}>
            取消
          </button>
          <button type="submit" className="btn primary" id="detail-save" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </form>

      <section className="comments" aria-label="任务讨论">
        <div className="comments-head">
          <h3>讨论</h3>
          <span className="comment-count">{commentLabel}</span>
        </div>
        <ul className="comment-list">
          {comments.items.map((comment) => {
            const author = commentAuthor(comment);
            return (
              <li className="comment" key={comment.id ?? `${author.name}-${comment.created_at}`}>
                <span className="avatar" aria-hidden="true" style={{ background: avatarColor(author.name) }}>
                  {author.name.charAt(0) || '?'}
                </span>
                <div className="comment-main">
                  <div className="comment-meta">
                    <span className="comment-author" title={author.username ? `@${author.username}` : undefined}>
                      {author.name}
                    </span>
                    <span
                      className="comment-time"
                      title={comment.created_at ? fullTime(comment.created_at) : undefined}
                    >
                      {relativeTime(comment.created_at)}
                    </span>
                  </div>
                  <p className="comment-text">{commentText(comment)}</p>
                </div>
              </li>
            );
          })}
        </ul>

        {comments.status === 'ready' && comments.items.length === 0 ? (
          <p className="comment-note">还没有留言，说说进展或 @ 一下同事。</p>
        ) : null}
        {comments.status === 'unavailable' ? (
          <p className="comment-note">
            评论接口还没上线（<code>{'GET/POST /api/tasks/{id}/comments'}</code>），后端接入后这里就能讨论。
          </p>
        ) : null}
        {comments.status === 'error' ? (
          <p className="comment-note">讨论加载失败：{comments.message}</p>
        ) : null}
        {comments.status === 'login' ? <p className="comment-note">登录后可以在这里参与讨论。</p> : null}

        {comments.status === 'ready' && signedIn ? (
          <div className="comment-compose">
            <textarea
              rows={2}
              maxLength={COMMENT_MAX}
              placeholder="写点进展，或 @ 同事（Enter 发送，Shift+Enter 换行）"
              value={commentText2}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  sendComment();
                }
              }}
            />
            <div className="comment-actions">
              <span className="comment-hint">
                {commentText2.length}/{COMMENT_MAX}
              </span>
              <button type="button" className="btn primary btn-sm" disabled={sending} onClick={sendComment}>
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <datalist id="assignee-options">
        {(assigneeOptions || []).map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
    </dialog>
  );
}
