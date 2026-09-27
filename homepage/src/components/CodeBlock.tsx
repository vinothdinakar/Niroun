export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <figure className="code">
      {label && <figcaption>{label}</figcaption>}
      <pre tabIndex={0}><code>{code}</code></pre>
    </figure>
  );
}
