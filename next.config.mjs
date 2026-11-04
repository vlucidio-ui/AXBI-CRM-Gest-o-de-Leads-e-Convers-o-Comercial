import { DEFAULT_EMBED_ORIGINS, parseAllowedOrigins } from "./lib/security.mjs";

// Sites autorizados a exibir o formulário público (/f/...) e a enviar para /api/public-lead.
// Lista explícita de origens (sem curingas), trocável pela variável EMBED_ALLOWED_ORIGINS (separadas por espaço).
// Uma origem inválida ou com curinga interrompe o build: melhor falhar do que liberar demais.
const embedOrigins = parseAllowedOrigins(process.env.EMBED_ALLOWED_ORIGINS ?? DEFAULT_EMBED_ORIGINS).join(" ");
// Diretivas que não dependem de nonce: bloqueiam plugins, troca da base dos links e envio de formulários para fora.
const baseCsp = "object-src 'none'; base-uri 'self'; form-action 'self'";

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      // Todo o CRM: nunca pode ser exibido dentro de outro site.
      { source: '/((?!f/).*)', headers: [
        ...common,
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: `frame-ancestors 'none'; ${baseCsp}` }
      ]},
      // Formulário público: pode ser incorporado apenas pelos sites autorizados.
      { source: '/f/:slug*', headers: [
        ...common,
        { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${embedOrigins}; ${baseCsp}` }
      ]}
    ];
  },
};
export default nextConfig;
