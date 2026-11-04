"use client";

import { CloudCrm } from "@/components/CloudCrm";
import { CrmApp } from "@/components/CrmApp";
import { localRepository } from "@/lib/repository";
import { supabaseEnabled } from "@/lib/supabase";

export default function Home() {
  if (supabaseEnabled) return <CloudCrm />;
  return (
    <>
      <div className="demo-banner" role="note">
        Modo demonstração: os dados ficam só neste navegador. Configure o Supabase para usar com equipe e dados reais.
      </div>
      <CrmApp repository={localRepository} />
    </>
  );
}
