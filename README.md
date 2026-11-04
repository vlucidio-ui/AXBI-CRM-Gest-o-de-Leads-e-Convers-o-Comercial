# AXBI CRM — V1.2

CRM comercial da AXBI Negócios Inteligentes: Next.js 14, React 18 e Supabase (Auth + PostgreSQL com RLS).

## Funcionalidades

- **Painel** com indicadores calculados a partir dos leads e gráfico por etapa.
- **Cadastro, edição e exclusão** de leads, com validação.
- **Pipeline Kanban** com as 10 etapas (arrastar e soltar no computador; seletor de etapa no celular).
- **Busca** por contato, empresa, e-mail, telefone, canal, campanha e necessidade; **filtro por etapa**.
- **Follow-ups** ordenados por data, com destaque para atrasados e do dia.
- **Origens**: leads, conversão e receita por canal.
- **Exportação CSV** (separador `;`, UTF-8 com BOM, fórmulas neutralizadas).
- **Login** com e-mail e senha, cadastro e recuperação de senha (Supabase Auth).
- **Organizações e equipe** com papéis: Proprietário, Administrador, Vendedor e Somente leitura.
- **Isolamento por organização** garantido no banco (RLS) e histórico de mudança de etapa.
- **Formulário público** de captação (`/f/<slug>`) com consentimento LGPD registrado, campo-armadilha antispam e limites de envio.
- Layout responsivo.

## Dois modos de execução

| Modo | Quando | Dados |
|---|---|---|
| Demonstração | `NEXT_PUBLIC_SUPABASE_*` vazias | Só no navegador (`localStorage`). Não usar com dados reais. |
| Produção | Variáveis do Supabase preenchidas | Banco Supabase, login e equipe. |

## Rodar localmente

Requisitos: Node.js 20 ou 22 e npm.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Sem configurar nada, o CRM abre em modo demonstração.

## Colocar em produção

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região `sa-east-1`, São Paulo).
2. No **SQL Editor**, rode os arquivos de `supabase/migrations/` **em ordem**:
   - `20261103000100_crm_initial_schema.sql` — tabela de leads.
   - `20261103000200_crm_tenant_security.sql` — organizações, membros, papéis, RLS e histórico.
   - `20261104000300_crm_public_form.sql` — formulário público, consentimento e limites.
   - `20261104000400_crm_public_form_phone.sql` — formulário aceita WhatsApp ou e-mail e guarda informações extras (ex.: regime tributário).

   Ou, com a CLI: `supabase link --project-ref <ref>` e `supabase db push`.
3. Em **Authentication → URL Configuration**, defina o *Site URL* com o endereço do site
   (ex.: `https://crm.suaempresa.com.br`) e adicione `https://<seu-dominio>/auth/redefinir-senha` em *Redirect URLs*.
4. Em **Authentication → Providers → Email**, mantenha a confirmação de e-mail ativa e defina senha mínima de 8 caracteres.
5. Para e-mails confiáveis em produção, configure um SMTP próprio (Authentication → SMTP).
6. Copie a **Project URL** e a **anon / publishable key** (Project Settings → API).

### 2. Vercel (hospedagem)

[![Deploy na Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvlucidio-ui%2FAXBI-CRM-Gest-o-de-Leads-e-Convers-o-Comercial&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY&envDescription=URL%20e%20chave%20p%C3%BAblica%20do%20Supabase&project-name=axbi-crm)

1. Em [vercel.com](https://vercel.com), importe este repositório do GitHub (ou use o botão acima).
2. Adicione as variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Faça o deploy. Volte ao passo 1.3 com o domínio final.

### 3. Primeiro acesso

1. Abra o site, clique em **Criar conta**, confirme o e-mail e entre.
2. Crie a organização (você vira Proprietário).
3. Peça para a equipe criar a conta e adicione cada pessoa em **Equipe**.
4. Em **Configurações**, ative o formulário público e informe o link da política de privacidade.
   O link do formulário aparece na mesma tela (aceita `?campanha=nome`).

## Formulário no site da empresa

Depois de ativar o formulário em **Configurações**, cole no site, onde ele deve aparecer:

```html
<div data-axbi-crm-form="SLUG-DA-ORGANIZACAO" data-campanha="site"></div>
<script src="https://SEU-CRM/embed.js" async></script>
```

- O formulário ajusta a altura sozinho e usa o `utm_campaign` da página como campanha (senão, o `data-campanha`).
- Por segurança, só os sites listados podem exibir o formulário. O padrão é `axbiinteligencia.com.br` e seus subdomínios;
  para outros, defina na Vercel `EMBED_ALLOWED_ORIGINS` (endereços separados por espaço, com `https://`) e faça um novo deploy.
- O restante do CRM nunca pode ser exibido dentro de outro site.
- Formulário próprio do site (ex.: seção de contato já existente): envie um `POST` para
  `https://<projeto>.supabase.co/rest/v1/rpc/crm_submit_public_lead` com o cabeçalho `apikey: <chave pública>` e o corpo
  `{p_slug, p_name, p_phone ou p_email, p_company, p_pain, p_notes, p_consent: true, p_consent_text, p_website: "", p_campaign}`.
- Alternativa sem incorporar: um botão com link para `https://SEU-CRM/f/SLUG-DA-ORGANIZACAO?campanha=site`.

## Testes

```bash
npm test               # regras de negócio + verificações estáticas das migrations
npm run check:syntax   # sintaxe TS/TSX
npm run typecheck      # tipos
npm run lint
npm run build
npm run test:db        # migrations + RLS num Postgres DESCARTÁVEL (exige DATABASE_URL)
npm run test:e2e       # navegador; exige o app rodando (npm start) e o pacote playwright
```

`test:db` apaga e recria o schema do banco apontado por `DATABASE_URL`. **Nunca** aponte para o Supabase.
Ele simula o Supabase Auth e verifica, entre outros: uma organização não lê, altera nem exclui dados de outra;
vendedor não exclui; leitor não edita; a organização não fica sem proprietário; anônimo não acessa tabelas;
formulário exige consentimento, descarta robôs e limita envios.

O GitHub Actions (`.github/workflows/ci.yml`) roda tudo isso a cada push e pull request.

## Segurança

- O navegador usa apenas a chave pública; toda a autorização é feita pelo RLS no banco.
- Nunca coloque a `service_role` em variáveis `NEXT_PUBLIC_*` nem no código do navegador (há teste que verifica).
- O visitante anônimo só consegue chamar `crm_public_form_info` e `crm_submit_public_lead`.
- Cabeçalhos de segurança configurados em `next.config.mjs`.
- `crm_purge_form_submissions()` limpa o controle antispam com mais de 7 dias; agende com `pg_cron` se desejar.

## Métricas

- **Leads cadastrados**: total de registros.
- **Em andamento**: exclui Fechado e Perdido.
- **Qualificados**: de Qualificado até Fechado.
- **Receita contratada**: soma do valor potencial em Fechado (não é receita contábil).
- **Pipeline em negociação**: soma de Proposta enviada e Negociação.
- **Taxa de fechamento**: Fechado ÷ (Proposta enviada + Negociação + Fechado + Perdido).

## Próximas evoluções

- Integração com WhatsApp e redes sociais.
- Importação de planilhas.
- CAC, LTV e atribuição de mídia.
- Backups automáticos fora do Supabase (o plano pago do Supabase já faz backups diários).
