export function Panel({ title, actions, children }) {
  return (
    <div className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <span>{title}</span>
          <span>{actions}</span>
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  )
}

export function Alert({ kind = 'err', children }) {
  if (!children) return null
  return <div className={`alert ${kind}`}>{children}</div>
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function Loading({ children = 'Đang tải…' }) {
  return <div className="spin">{children}</div>
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Kpi({ label, value, tone }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
    </div>
  )
}
