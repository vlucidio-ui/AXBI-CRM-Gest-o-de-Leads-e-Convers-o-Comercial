import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  // Regra nova do linter do React 19 (desempenho, não segurança): os componentes existentes carregam dados
  // em useEffect. Mantida desligada para não alterar telas comerciais nesta etapa de correções de segurança.
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  { ignores: ["**/*.d.mts", "scripts/**", ".next/**", "node_modules/**", "next-env.d.ts"] }
];
export default config;
