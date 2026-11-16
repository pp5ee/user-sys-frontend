import { NEXT_STATUS, PRIORITY_LABEL, PREV_STATUS, STATUS_LABEL } from '../constants.js';
import { avatarColor, fullTime, relativeTime } from '../session.js';

export default function TaskRow({ task, busy, isNew, onOpen, onChangeStatus }) {
  const next = NEXT_STATUS[task.status];
  const prev = PREV_STATUS[task.status];
  const note = typeof task.note === 'string' ? task.note.trim() : '';
  const meta = [`#${task.id}`];
  if (task.creator) meta.push(`创建人 ${task.creator}`);
  if (task.updated_at) meta.push(`更新于 ${relativeTime(task.updated_at)}`);

  return (
    <li
      className={`row${busy ? ' is-busy' : ''}${isNew ? ' is-new' : ''}`}
      data-id={task.id}
      data-status={task.status}
    >
      <div className="cell cell-title">
        <p className="task-title">
          <button
            className="task-open"
            type="button"
            title="打开任务详情"
            aria-label={`打开任务「${task.title}」`}
            data-focus={`open:${task.id}`}
            onClick={() => onOpen(task)}
          >
            {task.title}
          </button>
        </p>
        {note ? <p className="task-note">{note}</p> : null}
        <p className="task-meta" title={task.updated_at ? fullTime(task.updated_at) : ''}>
          {meta.join(' · ')}
        </p>
      </div>

      <div className="cell cell-assignee">
        <span className="avatar" aria-hidden="true" style={{ background: avatarColor(task.assignee) }}>
          {String(task.assignee || '?').trim().charAt(0) || '?'}
        </span>
        <span className="assignee-name" title={task.assignee}>
          {task.assignee}
        </span>
      </div>

      <div className="cell cell-priority">
        <span className="badge priority" data-priority={task.priority}>
          {PRIORITY_LABEL[task.priority] || task.priority}
        </span>
      </div>

      <div className="cell cell-status">
        <button
          className="chip status"
          type="button"
          data-status={task.status}
          data-focus={`status:${task.id}`}
          disabled={!next || busy}
          title={next ? `改为「${STATUS_LABEL[next]}」` : '已完成'}
          aria-label={
            next
              ? `「${task.title}」当前${STATUS_LABEL[task.status]}，改为${STATUS_LABEL[next]}`
              : `「${task.title}」已完成`
          }
          onClick={() => onChangeStatus(task, next)}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="status-label">{STATUS_LABEL[task.status] || task.status}</span>
        </button>
        {prev ? (
          <button
            className="revert"
            type="button"
            title="退回上一步"
            aria-label={`把「${task.title}」退回`}
            data-focus={`revert:${task.id}`}
            disabled={busy}
            onClick={() => onChangeStatus(task, prev)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7.5 5.5L3.5 9.5l4 4" />
              <path d="M3.5 9.5h7a5 5 0 0 1 0 10" />
            </svg>
          </button>
        ) : null}
        <button
          className="edit-btn"
          type="button"
          title="编辑任务"
          aria-label={`编辑「${task.title}」`}
          data-focus={`edit:${task.id}`}
          disabled={busy}
          onClick={() => onOpen(task)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12.5 3.5l4 4L7 17H3v-4z" />
            <path d="M10.5 5.5l4 4" />
          </svg>
        </button>
      </div>
    </li>
  );
}
