-- AlterTable
ALTER TABLE "IntegrationConfig" ADD COLUMN     "automation_days_after" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "automation_days_before" INTEGER NOT NULL DEFAULT 1;
