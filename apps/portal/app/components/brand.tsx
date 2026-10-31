export function Brand({
  name = "AnviOne",
  light = false,
}: {
  name?: string;
  light?: boolean;
}) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        {name}
        <span className="brand-period">.</span>
      </span>
    </span>
  );
}
