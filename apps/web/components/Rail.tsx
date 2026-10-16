// Trilho Pix tracejado (simulado) em cima, Base Sepolia sólida (verificável) embaixo.
// Só a linha do dinheiro se move, até o último passo concluído.
const MONEY_PATH = "M20 30 H100 V90 H500 V30 H580";
const STATIONS = [
  { x: 100, reachedAt: 21 },
  { x: 300, reachedAt: 50 },
  { x: 500, reachedAt: 100 },
];

export function Rail({ progress }: { progress: number }) {
  return (
    <figure className="rail" aria-label={`Progresso da travessia: ${progress}%`}>
      <div className="lane-labels">
        <span className="pix">Pix · simulado</span>
      </div>
      <svg viewBox="0 0 600 120" aria-hidden="true" focusable="false">
        <line className="lane lane-pix" x1="20" y1="30" x2="580" y2="30" />
        <line className="lane lane-base" x1="20" y1="90" x2="580" y2="90" />
        <path className="money" d={MONEY_PATH} pathLength={100} style={{ strokeDashoffset: 100 - progress }} />
        {STATIONS.map((s) => (
          <circle key={s.x} className={progress >= s.reachedAt ? "station station-done" : "station"} cx={s.x} cy={90} r={6} />
        ))}
      </svg>
      <div className="lane-labels">
        <span className="base">Base Sepolia · verificável</span>
      </div>
      <ol className="rail-acts">
        <li>Receba</li>
        <li>Guarde</li>
        <li>Pague</li>
      </ol>
    </figure>
  );
}
