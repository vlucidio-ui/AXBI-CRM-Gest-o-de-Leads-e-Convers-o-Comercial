-- Reversão de 20261112000800 (somente bancos de teste): APAGA todos os diagnósticos gravados.
drop table if exists public.crm_diagnostics;
drop function if exists public.crm_protect_diagnostic();
