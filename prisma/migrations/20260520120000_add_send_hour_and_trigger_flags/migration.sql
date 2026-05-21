-- AlterTable: add send_hour and per-trigger flags to IntegrationConfig
ALTER TABLE "IntegrationConfig" ADD COLUMN "send_hour" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "IntegrationConfig" ADD COLUMN "allow_before_due" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "IntegrationConfig" ADD COLUMN "allow_on_due" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "IntegrationConfig" ADD COLUMN "allow_overdue" BOOLEAN NOT NULL DEFAULT true;

-- AlterDefault: automation_days_before default 1 → 2
ALTER TABLE "IntegrationConfig" ALTER COLUMN "automation_days_before" SET DEFAULT 2;
