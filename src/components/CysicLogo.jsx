/**
 * Cysic 品牌标识（官方 mark）。
 *
 * 图形放在 public/ 下，用 BASE_URL 拼路径，兼容 `base: './'` 的子目录部署。
 * 带文字标时图形降级为装饰，避免读屏重复念一遍 "Cysic"。
 */
export default function CysicLogo({ size = 24, withWordmark = false, className = '' }) {
  return (
    <span className={`cysic-lockup${className ? ` ${className}` : ''}`}>
      <img
        className="cysic-mark"
        src={`${import.meta.env.BASE_URL}cysic-logo.svg`}
        width={size}
        height={size}
        alt={withWordmark ? '' : 'Cysic'}
        decoding="async"
      />
      {withWordmark ? <span className="cysic-word">Cysic</span> : null}
    </span>
  );
}
