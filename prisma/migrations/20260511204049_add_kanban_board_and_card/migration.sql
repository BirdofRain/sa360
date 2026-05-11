-- CreateTable
CREATE TABLE "KanbanBoard" (
    "id" TEXT NOT NULL,
    "boardKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanbanBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KanbanCard" (
    "id" TEXT NOT NULL,
    "boardKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "workstream" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "owner" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "dependencyCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptanceCriteria" JSONB,
    "dependencies" JSONB,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KanbanCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KanbanBoard_boardKey_key" ON "KanbanBoard"("boardKey");

-- CreateIndex
CREATE INDEX "KanbanCard_boardKey_status_sortOrder_idx" ON "KanbanCard"("boardKey", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "KanbanCard_boardKey_updatedAt_idx" ON "KanbanCard"("boardKey", "updatedAt");

-- AddForeignKey
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_boardKey_fkey" FOREIGN KEY ("boardKey") REFERENCES "KanbanBoard"("boardKey") ON DELETE CASCADE ON UPDATE CASCADE;
