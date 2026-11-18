-- Instruções do agente de atendimento, por app (Fase 4).
--
-- O que é comum a todos os apps mora no código: as regras de escalonamento
-- obrigatório e a proibição de prometer prazo não podem depender de alguém ter
-- preenchido um campo. Esta coluna guarda só o que muda de produto a produto.
ALTER TABLE "apps" ADD COLUMN "instrucoes_do_agente" TEXT;
