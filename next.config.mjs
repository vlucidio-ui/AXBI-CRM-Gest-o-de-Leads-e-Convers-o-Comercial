// Sites autorizados a exibir o formulário público (/f/...) dentro de um iframe.
// Pode ser trocado sem alterar o código pela variável EMBED_ALLOWED_ORIGINS (separados por espaço).
const embedOrigins = (process.env.EMBED_ALLOWED_ORIGINS
  ?? "https://axbiinteligencia.com.br https://*.axbiinteligencia.com.br").trim();

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
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }
      ]},
      // Formulário público: pode ser incorporado apenas pelos sites autorizados.
      { source: '/f/:slug*', headers: [
        ...common,
        { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${embedOrigins}` }
      ]}
    ];
  },
};
export default nextConfig;
