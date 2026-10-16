import { ACTS, STEP_ACT, STEP_ORDER, type StepName } from "@/lib/run/steps";
import type { RunView, StepView } from "@/lib/run/view";
import { ACT_COPY, explainError, formatSeconds, STEP_COPY, stepStatusLabel } from "@/lib/ui/labels";
import { CodeView } from "./CodeView";
import { HashLink } from "./HashLink";

function StepItem({ name, step }: { name: StepName; step: StepView | null }) {
  const copy = STEP_COPY[name];
  const status = step ? stepStatusLabel(step) : { text: "na fila", tone: "neutral" as const };
  const troubled = step?.status === "failed" || step?.status === "unknown";
  return (
    <li className="step" data-status={step?.status ?? "pending"}>
      <div className="step-head">
        <span className="step-title">{copy.title}</span>
        <span className={`chip chip-${status.tone}`}>{status.text}</span>
        {step?.latencyMs != null && <span className="step-time">{formatSeconds(step.latencyMs)}</span>}
      </div>
      <p className="step-call mono">{copy.call}</p>
      <p className="step-explain">{copy.explain}</p>
      {step && troubled && (
        <p className="step-error">
          {explainError(step.errorCode)}
          {step.errorMessage ? ` (${step.errorMessage})` : ""}
        </p>
      )}
      {step && troubled && step.hashes.length > 0 && (
        <ul className="step-hashes">
          {step.hashes.map((h) => (
            <li key={h.hash}>
              <HashLink hash={h.hash} href={h.url} />
            </li>
          ))}
        </ul>
      )}
      {step?.request && <CodeView request={step.request} response={step.response} idempotencyKey={step.idempotencyKey} />}
    </li>
  );
}

export function Acts({ view }: { view: RunView | null }) {
  return (
    <ol className="acts">
      {ACTS.map((act) => (
        <li key={act}>
          <h2 className="act-title">{ACT_COPY[act].title}</h2>
          <p className="act-lead">{ACT_COPY[act].lead}</p>
          <ol className="steps">
            {STEP_ORDER.filter((name) => STEP_ACT[name] === act).map((name) => (
              <StepItem key={name} name={name} step={view?.steps.find((s) => s.name === name) ?? null} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}
