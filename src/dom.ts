type Kid = Node | string | null | undefined | false;

/** Tiny hyperscript helper. Text is always inserted as text nodes, never HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], "style">> & { class?: string } = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const { class: cls, ...rest } = props as Record<string, unknown>;
  const node = Object.assign(document.createElement(tag), rest);
  if (cls) node.className = cls as string;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) node.append(k);
  return node;
}
