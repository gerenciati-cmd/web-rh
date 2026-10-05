-- AlterTable
ALTER TABLE "attendance"."devices" ADD COLUMN     "allowed_networks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "last_seen_ip" VARCHAR(45);
