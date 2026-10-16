#!/usr/bin/env node
// Carrega o TypeScript do pacote sem etapa de build.
import { register } from "tsx/esm/api";

register();
await import("../src/index.ts");
