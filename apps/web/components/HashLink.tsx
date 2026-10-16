"use client";

import { useState } from "react";

export function HashLink({ hash, href }: { hash: string; href: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sem acesso à área de transferência: o hash continua selecionável
    }
  }

  return (
    <span>
      <a className="hash mono" href={href} target="_blank" rel="noreferrer">
        {hash}
      </a>
      <button type="button" className="ghost" onClick={copy} aria-label="Copiar hash">
        {copied ? "copiado" : "copiar"}
      </button>
    </span>
  );
}
