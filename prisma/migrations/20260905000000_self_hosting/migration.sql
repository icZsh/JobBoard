-- AlterTable
ALTER TABLE "import_runs" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "result" JSONB;

-- CreateTable
CREATE TABLE "bootstrap" (
    "id" TEXT NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_runs" (
    "id" TEXT NOT NULL,
    "run_key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "config_snapshot" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "payload" JSONB,
    "error" TEXT,
    "import_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_files" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "original_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "extracted_text" TEXT,
    "confirmed_text" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_runs_run_key_key" ON "collection_runs"("run_key");

-- CreateIndex
CREATE UNIQUE INDEX "collection_runs_import_run_id_key" ON "collection_runs"("import_run_id");

-- CreateIndex
CREATE INDEX "collection_runs_status_created_at_idx" ON "collection_runs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "resume_files_storage_key_key" ON "resume_files"("storage_key");

-- CreateIndex
CREATE INDEX "resume_files_job_id_created_at_idx" ON "resume_files"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_idempotency_key_key" ON "import_runs"("idempotency_key");

-- AddForeignKey
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
