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
  await expect(page.getByRole("heading", { name: "O que o sandbox não prova" })).toHaveCount(0);
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
  const permalink = await page.getByRole("link", { name: "Link permanente" }).getAttribute("href");
  expect(permalink).toMatch(/^\/r\/[0-9a-f]{12}$/);

  const csv = await page.request.get(`${permalink}/csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).replace(/^﻿/, "").trimEnd().split("\r\n");
  expect(lines).toHaveLength(5);
  expect(lines.slice(1).every((line) => line.includes(",confere,"))).toBe(true);

  const runImage = await page.request.get(`${permalink}/opengraph-image`);
  expect(runImage.headers()["content-type"]).toBe("image/png");

  await page.goto(permalink!);
  await expect(page.getByTestId("verification-result").filter({ hasText: /^confere$/ })).toHaveCount(4);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(await seriousA11yViolations(page)).toEqual([]);
});

test("preview do link raiz e 404 para comprovante inexistente", async ({ page }) => {
  const image = await page.request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  expect((await page.request.get("/r/000000000000")).status()).toBe(404);
  expect((await page.request.get("/r/naoexiste/csv")).status()).toBe(404);
});

test("kill switch: mensagem clara e link para a última travessia concluída", async ({ page }) => {
  test.skip(!process.env.E2E_KILL_SWITCH, "só com o servidor iniciado com KILL_SWITCH=true");
  await page.goto("/");
  await page.getByRole("button", { name: "Executar com R$ 54,00" }).click();
  await expect(page.getByText("As execuções estão pausadas no momento.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Veja a última travessia concluída." })).toHaveAttribute("href", /^\/r\/[0-9a-f]{12}$/);
});
