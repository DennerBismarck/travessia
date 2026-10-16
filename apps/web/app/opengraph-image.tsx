import { renderCard } from "@/lib/og/card";

export const alt = "Travessia: receba em Pix, guarde em dólar, pague em stablecoin, conferido na Base Sepolia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return renderCard({
    eyebrow: "Não oficial · sandbox da Hodle · Base Sepolia",
    title: "Travessia",
    lines: ["Receba em Pix, guarde em dólar,", "pague em stablecoin."],
    footer: "Executado ao vivo e conferido na blockchain. Abra no celular: leva 2 minutos.",
  });
}
