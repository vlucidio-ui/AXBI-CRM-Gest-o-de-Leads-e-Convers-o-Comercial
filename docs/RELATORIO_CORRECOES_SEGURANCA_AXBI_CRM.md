# Relatório de correções de segurança — AXBI CRM

Data: 2026-11-05 · Branch: `feature/axbi-crm-initial-import` · Parecer: **APROVADO PARA REVISÃO DE MERGE** (com as pendências da seção G; nada foi aplicado no Supabase nem publicado)

## A. Resumo executivo

- **Estado inicial:** a branch `feature/axbi-crm-initial-import` (`323f52f`) estava 5 commits atrás da `main` (`d5ad759`) e não continha o código auditado (migrations, formulário, componentes). Foi avançada por *fast-forward* até a `main`, sem descartar commits e sem alterar a `main`.
- **Vulnerabilidades:** 10 confirmadas no código real. 5 delas foram reproduzidas contra o banco migrado antes da correção: autoria forjada, consentimento forjado, corrida no limite de envios (10 de 10 passaram com limite 3), TRUNCATE por leitor e organização sem proprietário (0 restantes).
- **Correções:** 3 migrations novas, todas com reversão; rota de servidor com CAPTCHA (Cloudflare Turnstile); consentimento oficial versionado; lista explícita de origens; atualização do Next 14 para o 16.
- **Resultado:** todas as suítes passam. As mesmas tentativas de ataque são bloqueadas e cobertas por testes de regressão. `npm audit --omit=dev`: 0.

## B. Matriz de vulnerabilidades

| ID | Vulnerabilidade | Severidade inicial | Correção | Teste | Resultado |
|---|---|---|---|---|---|
| V1 | `created_by` (e `created_at`) definidos ou alterados pelo cliente via REST | alta | gatilho `crm_protect_lead_fields`: na API, o banco preenche `auth.uid()`/`now()` e congela os campos | `20_security_test.sql` (autoria) | corrigido |
| V2 | Membro cria lead com `origin = public_form` e consentimento inventado, ou altera o consentimento | alta (LGPD) | mesmo gatilho: origem e campos de consentimento só pelo formulário; imutáveis depois | `20_security_test.sql` (V2) | corrigido |
| V3 | Texto de consentimento vem do navegador | alta (LGPD) | `crm_consent_terms` (texto, versão, finalidade) no banco; o envio exige a versão vigente; `crm_consent_records` (hash do texto, versão da política) | `20_security_test.sql` (V3/V5) | corrigido |
| V4 | Limites do formulário não atômicos (corrida) | alta | `pg_advisory_xact_lock` por organização antes de contar; limites por contato, IP e organização | `30_concurrency_test.sh` (3/3, 10/10, 60/60) | corrigido |
| V5 | Sem CAPTCHA; qualquer um envia direto com a chave pública | alta | `/api/public-lead` valida o Turnstile no servidor; o banco exige a chave de gateway (só o SHA-256 fica em `crm_private.settings`); honeypot validado no servidor | `tests/security.test.mjs`; `20_security_test.sql` | corrigido (ativo após configuração, seção G) |
| V6 | `authenticated` com TRUNCATE/TRIGGER/REFERENCES (privilégio padrão do Supabase); funções auxiliares executáveis por `anon` | média (TRUNCATE ignora RLS; não alcançável pelo PostgREST hoje) | `revoke all` + concessões explícitas; funções auxiliares revogadas | `20_security_test.sql` (V6) | corrigido |
| V7 | Dois proprietários se rebaixam ao mesmo tempo → organização sem dono | média | `crm_keep_one_owner` trava a organização (`for update`) | `30_concurrency_test.sh` (código antigo: 0 donos; novo: 1) | corrigido |
| V8 | Descoberta de e-mails cadastrados via `crm_add_member_by_email`, sem limite | média | 20 consultas/hora por usuário, com registro atômico; retorna `not_found` em vez de erro (para a tentativa contar) | `20_security_test.sql` (V8) | mitigado (o convite por e-mail continua revelando a existência da conta, por natureza) |
| V9 | `https://*.axbiinteligencia.com.br` autorizado a incorporar o formulário | baixa | lista explícita de origens exatas; curinga, http externo ou caminho interrompem o build; CORS só para a lista | `tests/security.test.mjs` | corrigido |
| V10 | Next 14.2.35 com advisories crítico/alto sem correção na linha 14; `supabase-js` baixo | crítica | Next 16.4.3, React 19.3.1, supabase-js 2.118.0 | `npm audit --omit=dev` = 0; build e E2E | corrigido |
| — | `crm_organizations.created_by` alterável por owner/admin (burla o limite de 10 organizações) | baixa | gatilho `crm_protect_org_fields` | `20_security_test.sql` | corrigido |
| — | CSP sem `object-src`, `base-uri`, `form-action` | baixa | diretivas adicionadas nas duas políticas | cabeçalhos conferidos com `curl` | corrigido |

Verificado e sem problema: todas as funções `SECURITY DEFINER` têm `search_path = ''` e nomes qualificados. `crm_has_role` e `crm_is_member` usam só `auth.uid()`, e `crm_list_members` exige ser membro. As policies não se somam por OR, porque há uma por comando. A exportação CSV já neutraliza fórmulas (`=+@-`). Não há `dangerouslySetInnerHTML`. Os redirecionamentos de Auth usam a origem atual.

## C. Arquivos alterados

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20261105000500_crm_privileges_hardening.sql` (+ rollback) | V6 |
| `supabase/migrations/20261105000600_crm_lead_integrity.sql` (+ rollback) | V1, V2, V7, V8, criador da organização |
| `supabase/migrations/20261105000700_crm_public_form_hardening.sql` (+ rollback) | V3, V4, V5 |
| `supabase/tests/10_rls_test.sql` | envios pela nova assinatura (gateway de teste); asserções anteriores mantidas |
| `supabase/tests/20_security_test.sql` (novo) | regressão de V1–V8 (positivos e negativos) |
| `supabase/tests/30_concurrency_test.sh` (novo) | concorrência real com processos paralelos |
| `scripts/test-db.sh` | reversão e reaplicação das migrations novas; roda as suítes novas |
| `lib/security.mjs`, `lib/security.d.mts` (novos) | origens, IP (HMAC), Turnstile, tratamento do envio, CORS |
| `app/api/public-lead/route.ts` (novo) | rota de servidor do formulário (limite de 16 KB no corpo) |
| `app/f/[slug]/page.tsx` | widget Turnstile; texto oficial vindo do banco; envio pela rota; `useParams` (Next 16) |
| `app/globals.css` | espaço do widget |
| `components/TeamPanel.tsx` | trata `not_found` do convite |
| `next.config.mjs` | lista explícita de origens; CSP reforçada |
| `app/auth/redefinir-senha/page.tsx` | `<Link>` (regra de lint do Next 16) |
| `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs` (`.eslintrc.json` removido) | V10; `next lint` não existe no Next 16 |
| `.env.example`, `README.md` | variáveis novas, ação administrativa, nova integração do site |
| `tests/security.test.mjs` (novo) | testes da rota e das regras de origem e segredos |

## D. Testes (executados nesta sessão)

| Comando | Resultado |
|---|---|
| `npm ci` | ok (363 pacotes) |
| `npm test` | 27/27 (15 anteriores + 12 novos de segurança) |
| `npm run check:syntax` | ok (15 arquivos) |
| `npm run typecheck` | ok (inclusive sem `.next/`, como no CI) |
| `npm run lint` | ok (ESLint 9, `eslint-config-next` 16) |
| `npm run build` | ok (Next 16.4.3) |
| `npm run test:db` — PostgreSQL 16.15 | ok: reversão e reaplicação; RLS; segurança; concorrência (87 asserções) |
| `npm run test:db` — PostgreSQL 17.11 | ok (mesmas 87 asserções) |
| `npm run test:e2e` (Chromium, modo local) | ok: cadastro, painel, pipeline, persistência, busca, CSV, origens, exclusão, celular |
| Cabeçalhos (`curl` no `next start`) | `/f/*`: `frame-ancestors` só com as origens exatas; demais páginas: `frame-ancestors 'none'` + `X-Frame-Options: DENY`; `/api/public-lead` sem segredos: 503; origem estranha: 403; CORS só para a origem autorizada |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| `npm audit` (com dev) | 16 moderadas, todas na cadeia do ESLint (`minimatch`), sem efeito em produção |

**Limitações:** os testes de banco usam PostgreSQL com o stub do Supabase (papéis, `auth.uid()` e privilégios padrão), não o PostgREST e o GoTrue reais. O Turnstile foi testado com respostas simuladas da Cloudflare: sucesso, token inválido, expirado/reutilizado, ação errada, hostname errado e falha de rede. Não houve teste com o widget real nem no Supabase hospedado.

## E. Supabase

- **Migrations criadas e testadas localmente** (aplicação, reversão e reaplicação; PG16 e PG17): `20261105000500`, `20261105000600`, `20261105000700`.
- **Não aplicadas** no projeto `axbi-crm`, por regra desta tarefa. As migrations antigas não foram editadas.
- **Ação administrativa** depois da `000700`: gravar `form_gateway_sha256` em `crm_private.settings` (comando no README e no cabeçalho da migration). Sem isso o formulário fica indisponível. É falha fechada, de propósito.
- **Incompatibilidade intencional:** a `000700` remove a versão antiga de `crm_submit_public_lead`. A aplicação da migration e o deploy do CRM precisam acontecer juntos, e o formulário próprio do site precisa migrar para `/api/public-lead` com Turnstile (README).

## F. GitHub

- **Repositório:** `vlucidio-ui/AXBI-CRM-Gest-o-de-Leads-e-Convers-o-Comercial`.
- **HEAD inicial da branch:** `323f52f`. A `main` estava em `d5ad759` (intacta). A branch foi avançada por *fast-forward* até `d5ad759` e recebeu os commits desta etapa.
- **PRs:** #1 a #5 já mesclados na `main`; nenhum PR aberto para esta branch. Não houve merge nem alteração na `main`.

## G. Pendências reais para homologação

| Depende de | Item |
|---|---|
| Configuração externa | Criar o widget no Cloudflare Turnstile (domínios do CRM e do site); `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` e `CRM_FORM_GATEWAY_SECRET` na Vercel; opcional `TURNSTILE_ALLOWED_HOSTNAMES`; revisar `EMBED_ALLOWED_ORIGINS` |
| Administrador Supabase + autorização | Aplicar as 3 migrations no `axbi-crm`, gravar o SHA-256 do segredo, conferir os advisors e fazer o deploy do CRM na mesma janela |
| Site axbiinteligencia.com.br | Trocar o envio direto ao Supabase pelo `POST /api/public-lead` com o widget Turnstile (`action = public-lead`) |
| Administrador Supabase | Agendar `crm_purge_form_submissions()` e `crm_purge_member_lookups()` (`pg_cron`) |
| Homologação manual | Formulário incorporado e formulário do site com o Turnstile real; REST real (anon sem chave recusado; `created_by` forjado ignorado); envio duplicado; limites |
| Produto/jurídico | Texto e finalidade do termo de consentimento (versão `2026-11-05`) e versão da política de privacidade (`privacy_policy_version` ainda não tem campo na tela de Configurações). A existência do consentimento **não** comprova conformidade integral com a LGPD |
| Riscos residuais | `crm_public_form_info` continua público (só nome, link da política e texto do termo; sem limite próprio além do Supabase); CSP de scripts com nonce não implementada; limite de 10 organizações por usuário sem trava (corrida de baixo impacto); 16 advisories moderados só em ferramentas de desenvolvimento |

## H. Parecer final

**APROVADO PARA REVISÃO DE MERGE.** As vulnerabilidades críticas e altas foram corrigidas e cobertas por testes executados (unitários, banco em PG16/PG17 com concorrência real, build, E2E e auditoria). Não é aprovação para produção: falta aplicar e homologar no Supabase hospedado, com o Turnstile real e o site atualizado (seção G).
