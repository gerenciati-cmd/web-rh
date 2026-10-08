-- AlterTable
ALTER TABLE "attendance"."device_commands" ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "return_code" VARCHAR(16);

-- CreateIndex
CREATE UNIQUE INDEX "device_commands_number_key" ON "attendance"."device_commands"("number");
