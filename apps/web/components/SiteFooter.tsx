import { HODLE_SANDBOX_DOCS_URL, REPO_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="footer">
      <a href={REPO_URL}>Código no GitHub</a>
      <a href={HODLE_SANDBOX_DOCS_URL}>Sandbox da Hodle</a>
      <span>Projeto independente, sem vínculo oficial com a Hodle.</span>
    </footer>
  );
}
