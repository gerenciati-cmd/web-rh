-- AlterTable
ALTER TABLE "employees"."employees" ADD COLUMN     "site_id" UUID;

-- CreateIndex
CREATE INDEX "employees_site_id_status_idx" ON "employees"."employees"("site_id", "status");
