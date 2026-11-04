import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "**/*.d.mts", "scripts/**"] }
];

export default config;
