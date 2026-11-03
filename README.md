# AXBI CRM — V1.1

CRM comercial inicial da AXBI Negócios Inteligentes. Esta entrega mantém a aplicação simples e leve: Next.js 14, React 18 e Supabase/PostgreSQL preparado para integração.

## Funcionalidades disponíveis

- Dashboard com indicadores calculados a partir dos leads.
- Cadastro, edição e exclusão de leads.
- Pipeline Kanban com todas as etapas, inclusive Perdido e Nutrição.
- Busca por contato, empresa, e-mail, telefone, canal, campanha e necessidade.
- Filtro por etapa.
- Follow-ups e identificação de ações atrasadas.
- Visão de origem por canal.
- Exportação de leads em CSV (separador `; `, UTF-8 com BOM).
- Persistência local no navegador via `localStorage`.
- Validação dos dados recuperados do navegador para evitar carregar estruturas inválidas.
- Identificadores de lead com UUID quando disponível.
- Layout responsivo.

## Limite funcional e de segurança

**Ainda não é uma aplicação de produção.** Os dados ficam somente no navegador e não são compartilhados entre pessoas ou dispositivos. Não há autenticação, conexão ativa com Supabase, sincronização, formulário público, WhatsApp ou integração de redes sociais. Não cadastrar dados reais, pessoais ou confidenciais nesta versão.

A exportação CSV neutraliza inícios de fórmula (`=`, `+`, `-`, `@`) para reduzir risco de execução de fórmulas ao abrir em planilhas. O CSV continua sendo um arquivo de dados, não um backup transacional.

## Requisitos

- Node.js 20 LTS ou 22 LTS.
- npm.

## Instalação local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Testes

```bash
npm test
npm run check:syntax
npm run lint
npm run build
```

- `npm test`: testes unitários das regras de domínio e verificações estáticas das migrations com o test runner nativo do Node.
- `npm run check:syntax`: transpila os arquivos TypeScript/TSX para detectar erros de sintaxe.
- `npm run lint`: lint do Next.js.
- `npm run build`: build de produção do Next.js.

A aprovação dos dois primeiros comandos não substitui typecheck, lint, build, testes de navegador ou testes de banco.

## Banco Supabase

- `supabase/migrations/20261103000100_crm_initial_schema.sql`: tabelas base.
- `supabase/migrations/20261103000200_crm_tenant_security.sql`: organizações, membros, isolamento por organização, RLS e trilha de mudança de etapa.

A segunda migration pressupõe Supabase Auth e o schema inicial. Ela ainda **não foi aplicada nem validada em um projeto Supabase real**. Faça backup e aplique primeiro em ambiente de desenvolvimento. A interface V1 ainda não usa essas tabelas; a aplicação da migration não conecta automaticamente o CRM ao banco.

A primeira organização deve ser criada pela função `public.crm_create_organization(text)` com usuário autenticado. Não conceder acesso de `service_role` ao navegador e nunca colocar `service_role` em variáveis `NEXT_PUBLIC_*`.

## Variáveis de ambiente

Consulte `.env.example`. A conexão Supabase será implementada em etapa separada, depois da validação do modelo de autenticação e da camada de servidor. Não preencher variáveis com chaves fictícias.

## Próximas etapas para produção

1. Conectar Supabase Auth e recuperação de senha.
2. Implementar organização ativa e papéis na camada de servidor.
3. Trocar `localStorage` por persistência Supabase com RLS.
4. Validar isolamento entre duas organizações e usuários com papéis distintos.
5. Implementar formulário público com consentimento LGPD, antispam e limites.
6. Automatizar testes E2E, observabilidade, backup e deploy.

## Métricas

- Leads cadastrados: total de registros.
- Em andamento: exclui Fechado e Perdido.
- Qualificados: etapas a partir de Qualificado até Fechado.
- Receita contratada: soma do valor potencial dos leads em Fechado; não equivale à receita contábil reconhecida.
- Pipeline em negociação: soma de Proposta enviada e Negociação.
- Taxa de fechamento: Fechado dividido por Proposta enviada + Negociação + Fechado + Perdido.

As métricas são operacionais. CAC, LTV, receita reconhecida e atribuição de mídia ainda não estão implementados.
