-- AlterTable
ALTER TABLE "attendance"."device_commands" ALTER COLUMN "queued_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "attendance"."device_users" (
    "device_id" UUID NOT NULL,
    "pin" VARCHAR(32) NOT NULL,
    "employee_id" UUID NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_users_pkey" PRIMARY KEY ("device_id","pin")
);

-- CreateIndex
CREATE INDEX "device_users_employee_id_idx" ON "attendance"."device_users"("employee_id");

-- AddForeignKey
ALTER TABLE "attendance"."device_users" ADD CONSTRAINT "device_users_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance"."devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
