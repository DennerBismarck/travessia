"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Recarrega os dados do servidor a cada intervalo e mostra há quanto tempo foram lidos. */
export function AutoRefresh({ generatedAt, intervalMs = 20_000 }: { generatedAt: string; intervalMs?: number }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const refresh = setInterval(() => router.refresh(), intervalMs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, intervalMs]);

  const age = now === null ? 0 : Math.max(0, Math.round((now - Date.parse(generatedAt)) / 1000));
  return (
    <p className="muted small">
      Atualizado {age === 0 ? "agora" : `há ${age} s`} · atualiza sozinho a cada {intervalMs / 1000} s
    </p>
  );
}
