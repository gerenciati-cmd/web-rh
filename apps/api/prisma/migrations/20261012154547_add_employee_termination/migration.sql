-- CreateEnum
CREATE TYPE "employees"."TerminationReason" AS ENUM ('VOLUNTARY_RESIGNATION', 'DISMISSAL_WITH_CAUSE', 'DISMISSAL_WITHOUT_CAUSE', 'MUTUAL_AGREEMENT', 'END_OF_CONTRACT', 'DEATH', 'INCAPACITY', 'OTHER');

-- AlterTable
ALTER TABLE "employees"."employees" ADD COLUMN     "termination_date" DATE,
ADD COLUMN     "termination_reason" "employees"."TerminationReason";
