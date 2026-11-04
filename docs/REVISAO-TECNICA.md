# Revisão técnica — AXBI CRM

Data: 04/11/2026 · Base revisada: `main` em `d5ad759` (PRs #1 a #5).

## 1. Situação encontrada

| Item | Estado |
|---|---|
| Código (PRs #1 a #5) | Já incorporado à `main` |
| Banco Supabase `axbi-crm` (sa-east-1) | 4 migrations aplicadas; formulário público ativado para a organização `axbi-crm` |
| Hospedagem | Projeto Vercel ligado ao repositório: cada push na `main` publica em produção |
| Dados reais | 1 usuário e 1 organização cadastrados; nenhum lead até a data |

Esta revisão **não** altera o banco, não faz deploy e não faz merge. As mudanças abaixo entram na `main` somente após aprovação do PR.

## 2. Achados e correções deste PR

| # | Severidade | Achado | Correção |
|---|---|---|---|
| 1 | Crítica | `next@14.2.35` tem vulnerabilidades críticas e altas publicadas (execução remota de código no otimizador de imagens, SSRF, negação de serviço em Server Components/Server Actions, cache poisoning). Várias dependem de recursos que o CRM não usa (next/image, Server Actions, servidor Windows), mas a linha 14 não recebe mais correções. | Atualizado para `next@16.4.2` e `react@19.1.10` (versões com mais de 2 semanas de publicação, fora das faixas vulneráveis). |
| 2 | Baixa | `@supabase/supabase-js@2.45.4` depende de `auth-js` vulnerável (roteamento de caminho com entrada malformada). | Atualizado para `2.118.0`. |
| 3 | Média (funcional) | Em Configurações, o link da política de privacidade aparecia sempre vazio e não podia ser removido. | O campo carrega o valor salvo; apagar o campo remove o link. |
| 4 | Baixa (qualidade) | O ESLint do Next 16 apontou 4 telas que atualizavam estado dentro de efeitos (renderizações extras) e um link interno sem `<Link>`. | Cargas iniciais reescritas para atualizar o estado só após a resposta (com cancelamento ao desmontar); `<Link>` no lugar de `<a>`. Organizações ficam associadas ao usuário logado, evitando exibir dados de uma conta anterior após troca de usuário. |
| 5 | — (compatibilidade) | Next 16 removeu `next lint` e passou parâmetros de rota como Promise. | Lint via `eslint .` com `eslint.config.mjs`; `/f/[slug]` lê o parâmetro com `useParams()`. |

Resultado de `npm audit --omit=dev` após o PR: **0 vulnerabilidades**. Restam 16 alertas moderados apenas em ferramentas de desenvolvimento (lint/`minimatch`), que não vão para o servidor.

## 3. Testes executados

| Verificação | Resultado |
|---|---|
| `npm test` (regras de negócio + verificações estáticas das migrations) | 15/15 |
| `npm run typecheck`, `npm run lint`, `npm run check:syntax` | OK |
| `npm run build` (Next 16) | OK |
| `npm run test:db` (migrations + RLS em PostgreSQL 16 local) | 36 verificações OK |
| E2E no navegador, modo local (cadastro, painel, pipeline, persistência, busca, CSV, origens, exclusão, celular) | OK |
| Modo Supabase: tela de login renderiza | OK |
| Formulário incorporado em site autorizado (respostas do banco simuladas): exibe, ajusta altura, envia nome, e-mail, consentimento e campanha | OK |
| Site não autorizado tentando incorporar o formulário | Bloqueado (`frame-ancestors`) |
| Cabeçalhos: CRM com `X-Frame-Options: DENY` e `frame-ancestors 'none'` | OK |
| CI do GitHub (app + banco) | Ver checks deste PR |

## 4. Pendências e riscos conhecidos

**Antes ou durante a implantação controlada**
1. Testar o login real ponta a ponta após o deploy (cadastro, confirmação de e-mail, redefinição de senha, criação de organização, convite de membro). A rede do ambiente de revisão bloqueia o domínio do Supabase, então esse fluxo só foi testado no banco e com respostas simuladas.
2. Configurar SMTP próprio no Supabase (o envio padrão é limitado a poucos e-mails por hora).
3. Conferir no Supabase Auth: *Site URL* e *Redirect URLs* com o domínio definitivo (inclusive `/auth/redefinir-senha`).
4. Publicar uma página de política de privacidade e informá-la em Configurações (o texto de consentimento já é registrado em cada lead).
5. Publicar na Cloudflare a nova versão do site (seção de contato ligada ao CRM). Ainda não publicada.

**Melhorias recomendadas (não bloqueiam)**
6. Limite de 60 envios por hora é por organização: um robô insistente pode esgotar a cota e bloquear leads reais por até 1 hora. Sugestão: limite por IP via Edge Function ou Cloudflare Turnstile.
7. Agendar `crm_purge_form_submissions()` (pg_cron) para apagar o controle antispam com mais de 7 dias.
8. Content-Security-Policy completa para o CRM (hoje só `frame-ancestors`).
9. O formulário próprio do CRM (`/f/...`) ainda exige e-mail; o banco já aceita WhatsApp ou e-mail. Alinhar o formulário se quiser captar só por WhatsApp.
10. Edição simultânea do mesmo lead: vale a última gravação (sem aviso de conflito).
11. Backups: o plano gratuito do Supabase não inclui backup diário automático.

## 5. Implantação controlada sugerida

1. Aprovar este PR → merge na `main` → Vercel publica automaticamente.
2. Smoke test em produção: abrir o CRM, entrar, criar um lead, mover no pipeline, exportar CSV; enviar um lead de teste pelo formulário público e conferir no pipeline.
3. Em caso de problema: na Vercel, *Deployments* → promover o deploy anterior (rollback em segundos). O banco não muda neste PR, então não há migração a reverter.
