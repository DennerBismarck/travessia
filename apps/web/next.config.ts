import { join } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // monorepo: o rastreamento de arquivos parte da raiz para incluir packages/hodle
  outputFileTracingRoot: join(process.cwd(), "../.."),
  transpilePackages: ["@travessia/hodle"],
  poweredByHeader: false,
};

export default config;
