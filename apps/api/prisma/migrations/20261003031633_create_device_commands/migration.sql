-- CreateTable
CREATE TABLE "attendance"."device_commands" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "command" VARCHAR(500) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "queued_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "queued_by" UUID NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_commands_device_id_status_queued_at_idx" ON "attendance"."device_commands"("device_id", "status", "queued_at");

-- AddForeignKey
ALTER TABLE "attendance"."device_commands" ADD CONSTRAINT "device_commands_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance"."devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
