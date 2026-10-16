export function RunLinks({ runId }: { runId: string }) {
  return (
    <nav className="run-links" aria-label="Comprovante desta execução">
      <a href={`/r/${runId}`}>Link permanente</a>
      <a href={`/r/${runId}/csv`} download>
        Extrato CSV
      </a>
    </nav>
  );
}
