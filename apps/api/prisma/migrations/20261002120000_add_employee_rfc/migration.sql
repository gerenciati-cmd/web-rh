-- AlterTable
ALTER TABLE "employees"."employees" ADD COLUMN     "rfc" VARCHAR(13);

-- CreateIndex
CREATE UNIQUE INDEX "employees_rfc_key" ON "employees"."employees"("rfc");
