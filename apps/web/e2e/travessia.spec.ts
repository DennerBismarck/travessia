import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function seriousA11yViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("tela inicial: aviso, carteira e botão, sem rolagem horizontal e acessível", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Não oficial — construído sobre o sandbox da Hodle.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Executar com R$ 54,00" })).toBeEnabled();
  await expect(page.getByText("Carteira de teste na Base Sepolia")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(await seriousA11yViolations(page)).toEqual([]);
});

test("executa a travessia e confere os quatro movimentos na Base Sepolia", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Executar com R$ 54,00" }).click();
  await expect(page.getByTestId("run-status")).toHaveText(/Travessia concluída/, { timeout: 120_000 });
  await expect(page.getByTestId("verification-result").filter({ hasText: /^confere$/ })).toHaveCount(4);
  await expect(page.getByTestId("closing")).toContainText("Fecha no centavo.");
  await page.getByRole("button", { name: "Pagar de novo (mesma chave)" }).click();
  await expect(page.getByTestId("replay-result")).toContainText("Mesmo transactionId e mesmo txHash");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(await seriousA11yViolations(page)).toEqual([]);
});
