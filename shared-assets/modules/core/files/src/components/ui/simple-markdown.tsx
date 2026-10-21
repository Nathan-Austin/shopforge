import React from "react";

// Render product rich text content. Accepts HTML (from the editor) or plain **bold**/*italic* markdown.
export function SimpleMarkdown({ children, className }: { children: string; className?: string }) {
  if (!children) return null;

  // HTML content from the rich text editor — normalize div/p block structure to <br> then render
  if (/<\/?[a-z][\s\S]*>/i.test(children)) {
    const normalized = children
      .replace(/[\r\n]+/g, "")
      .replace(/<(div|p)><br\s*\/?><\/(div|p)>/gi, "<br><br>")
      .replace(/<\/(div|p)>\s*<(div|p)[^>]*>/gi, "<br>")
      .replace(/<(div|p)[^>]*>/gi, "")
      .replace(/<\/(div|p)>/gi, "")
      .replace(/^<br>/i, "");
    return (
      <span
        className={className}
        dangerouslySetInnerHTML={{ __html: normalized }}
      />
    );
  }

  // Plain markdown fallback
  // Normalize CRLF/CR line endings first — splitting on "\n" alone leaves a
  // stray "\r"-only line for every "\r\n\r\n" paragraph break, which then
  // renders as its own extra line break under the parent's white-space: pre-line.
  const lines = children.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").split("\n");

  function parseLine(line: string, lineKey: number): React.ReactNode {
    const nodes: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(line.slice(lastIndex, match.index));
      }
      if (match[1] !== undefined) {
        nodes.push(<strong key={key++}>{match[1]}</strong>);
      } else if (match[2] !== undefined) {
        nodes.push(<em key={key++}>{match[2]}</em>);
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      nodes.push(line.slice(lastIndex));
    }

    return <span key={lineKey}>{nodes}</span>;
  }

  return (
    <span className={className}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {parseLine(line, i)}
          {i < lines.length - 1 && "\n"}
        </React.Fragment>
      ))}
    </span>
  );
}
