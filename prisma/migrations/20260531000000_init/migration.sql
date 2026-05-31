-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('NEW', 'INTERESTED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'PASSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "import_run_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "run_date" DATE NOT NULL,
    "source_name" TEXT,
    "status" "import_run_status" NOT NULL DEFAULT 'PENDING',
    "raw_payload" JSONB NOT NULL,
    "error_message" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "remote_type" TEXT,
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "description" TEXT,
    "source_url" TEXT,
    "normalized_source_url" TEXT,
    "date_posted" TIMESTAMP(3),
    "dedupe_key" TEXT NOT NULL,
    "fallback_dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_recommendations" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "fit_score" INTEGER,
    "priority" "priority",
    "matched_skills" TEXT[],
    "missing_skills" TEXT[],
    "match_reason" TEXT,
    "concerns" TEXT,
    "suggested_action" TEXT,
    "raw_recommendation" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_tracking" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'NEW',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "next_action" TEXT,
    "next_action_date" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "resume_path" TEXT,
    "resume_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_run_date_created_at_idx" ON "import_runs"("run_date", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "jobs_normalized_source_url_idx" ON "jobs"("normalized_source_url");

-- CreateIndex
CREATE INDEX "jobs_fallback_dedupe_key_idx" ON "jobs"("fallback_dedupe_key");

-- CreateIndex
CREATE INDEX "jobs_company_title_idx" ON "jobs"("company", "title");

-- CreateIndex
CREATE INDEX "job_recommendations_job_id_idx" ON "job_recommendations"("job_id");

-- CreateIndex
CREATE INDEX "job_recommendations_import_run_id_idx" ON "job_recommendations"("import_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_recommendations_job_id_import_run_id_key" ON "job_recommendations"("job_id", "import_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_tracking_job_id_key" ON "job_tracking"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AddForeignKey
ALTER TABLE "job_recommendations" ADD CONSTRAINT "job_recommendations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_recommendations" ADD CONSTRAINT "job_recommendations_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_tracking" ADD CONSTRAINT "job_tracking_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
