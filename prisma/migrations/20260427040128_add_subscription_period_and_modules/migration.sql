-- CreateEnum
CREATE TYPE "SubPeriod" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubModule" AS ENUM ('HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "asaas_payment_id" TEXT,
ADD COLUMN     "period" "SubPeriod" NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "asaas_customer_id" TEXT;
