-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "payment_failed_at" TIMESTAMP(3),
ADD COLUMN     "payment_failure_reason" TEXT;
