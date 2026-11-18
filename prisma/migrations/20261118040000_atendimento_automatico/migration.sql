-- O agente atende sozinho os chamados novos deste app?
--
-- Chave separada do modo sombra, e DESLIGADA por padrão: o modo sombra decide
-- se a resposta sai sem revisão; esta decide se a IA é acionada. Nenhum app
-- deve começar a gastar sozinho porque alguém publicou um deploy.
ALTER TABLE "apps" ADD COLUMN "atendimento_automatico" BOOLEAN NOT NULL DEFAULT false;
