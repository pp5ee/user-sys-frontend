export default function Toasts({ items }) {
  return (
    <div id="toasts" className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div className={`toast${item.kind === 'error' ? ' error' : ''}${item.out ? ' out' : ''}`} key={item.id}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
