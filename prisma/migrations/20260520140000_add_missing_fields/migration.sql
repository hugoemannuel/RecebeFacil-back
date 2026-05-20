-- Add whatsapp_opted_out to User (opt-out de mensagens automáticas)
ALTER TABLE "User" ADD COLUMN "whatsapp_opted_out" BOOLEAN NOT NULL DEFAULT false;

-- Add asaas_invoice_url to Charge (link de pagamento gerado pelo Asaas)
ALTER TABLE "Charge" ADD COLUMN "asaas_invoice_url" TEXT;
