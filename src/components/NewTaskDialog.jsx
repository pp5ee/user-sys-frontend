import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { ASSIGNEE_MAX, NOTE_MAX, PRIORITY_LABEL, TASK_TITLE_MAX } from '../constants.js';
import { translateFieldMessage } from '../session.js';

const emptyErrors = { title: '', assignee: '', note: '' };

export default function NewTaskDialog({ assigneeOptions, defaultAssignee, onClose, onCreated, onToast }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const assigneeRef = useRef(null);
  const noteRef = useRef(null);
  const closedRef = useRef(false);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(defaultAssignee || '');
  const [priority, setPriority] = useState('medium');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState(emptyErrors);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    titleRef.current?.focus();
  }, []);

  const options = useMemo(() => assigneeOptions || [], [assigneeOptions]);

  function finish() {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }

  function close() {
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog?.removeAttribute('open');
    finish();
  }

  function validate() {
    const value = title.trim();
    const owner = assignee.trim();
    const memo = note.trim();
    const next = { title: '', assignee: '', note: '' };
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

    if (memo.length > NOTE_MAX) {
      next.note = `备注最多 ${NOTE_MAX} 字`;
      valid = false;
    }

    setErrors(next);
    if (!valid) {
      (!value ? titleRef : !owner ? assigneeRef : noteRef).current?.focus();
      return null;
    }
    return { title: value, assignee: owner, note: memo };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const values = validate();
    if (!values) return;

    // 没填备注就不提交 note，避免后端存空字符串
    const payload = { title: values.title, assignee: values.assignee, priority };
    if (values.note) payload.note = values.note;

    setBusy(true);
    try {
      const task = await api.create(payload);
      onCreated(task);
      onToast?.('任务已创建');
      close();
    } catch (err) {
      if (err.status === 401 || err.status === 403) return;
      const fields = err.fields || {};
      if (fields.title || fields.assignee || fields.note) {
        setErrors({
          title: fields.title ? translateFieldMessage(fields.title) : '',
          assignee: fields.assignee ? translateFieldMessage(fields.assignee) : '',
          note: fields.note ? translateFieldMessage(fields.note) : '',
        });
        onToast?.('请检查填写内容', 'error');
      } else {
        onToast?.(err.message || '创建失败', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      id="task-dialog"
      className="dialog"
      ref={dialogRef}
      onClose={finish}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
    >
      <form id="task-form" onSubmit={handleSubmit} noValidate>
        <header className="dialog-head">
          <h2>新建任务</h2>
          <button type="button" className="icon-btn" id="dialog-close" aria-label="关闭" onClick={close}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>

        <div className="field">
          <div className="field-head">
            <label htmlFor="f-title">标题</label>
            <span className="counter" id="title-counter">
              {title.length}/{TASK_TITLE_MAX}
            </span>
          </div>
          <input
            id="f-title"
            name="title"
            type="text"
            maxLength={TASK_TITLE_MAX}
            placeholder="例如：把登录页的联调做完"
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
            <p className="field-error" id="title-error">
              {errors.title}
            </p>
          ) : null}
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="f-assignee">负责人</label>
            <span className="counter" id="assignee-counter">
              {assignee.length}/{ASSIGNEE_MAX}
            </span>
          </div>
          <input
            id="f-assignee"
            name="assignee"
            type="text"
            maxLength={ASSIGNEE_MAX}
            list="assignee-options"
            placeholder="谁来负责，可从成员里选"
            autoComplete="off"
            required
            value={assignee}
            ref={assigneeRef}
            aria-invalid={errors.assignee ? 'true' : 'false'}
            onChange={(event) => {
              setAssignee(event.target.value);
              if (errors.assignee) setErrors((prev) => ({ ...prev, assignee: '' }));
            }}
          />
          {errors.assignee ? (
            <p className="field-error" id="assignee-error">
              {errors.assignee}
            </p>
          ) : null}
        </div>

        <div className="field">
          <div className="field-head">
            <span className="label-like" id="priority-label">
              优先级
            </span>
          </div>
          <div className="segmented" role="radiogroup" aria-labelledby="priority-label">
            {['low', 'medium', 'high'].map((value) => (
              <label className="seg" key={value}>
                <input
                  type="radio"
                  name="priority"
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
            <label htmlFor="f-note">
              备注 <span className="field-optional">选填</span>
            </label>
            <span className="counter" id="note-counter">
              {note.length}/{NOTE_MAX}
            </span>
          </div>
          <textarea
            id="f-note"
            name="note"
            rows={3}
            maxLength={NOTE_MAX}
            placeholder="补充说明，最多 200 字"
            ref={noteRef}
            value={note}
            aria-invalid={errors.note ? 'true' : 'false'}
            onChange={(event) => {
              setNote(event.target.value);
              if (errors.note) setErrors((prev) => ({ ...prev, note: '' }));
            }}
          />
          {errors.note ? (
            <p className="field-error" id="note-error">
              {errors.note}
            </p>
          ) : null}
        </div>

        <p className="dialog-hint">新任务会以「待办」状态创建，之后可以点开任务编辑、指派或改状态。</p>

        <footer className="dialog-actions">
          <button type="button" className="btn ghost" id="dialog-cancel" onClick={close}>
            取消
          </button>
          <button type="submit" className="btn primary" id="dialog-submit" disabled={busy}>
            {busy ? '创建中…' : '新建任务'}
          </button>
        </footer>
      </form>
      <datalist id="assignee-options">
        {options.map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>
    </dialog>
  );
}
