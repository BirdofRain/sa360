import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();
const db = new PrismaClient();

function maskDbUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
      user: u.username ? `${u.username.slice(0, 3)}***` : null,
      ssl: u.searchParams.get("sslmode") ?? u.search.includes("sslmode") ? "configured" : "unknown",
    };
  } catch {
    return { host: "unparseable" };
  }
}

const pending = new Set([
  "20260601170000_reconcile_client_ghl_destination_option_map",
  "20260708180000_fulfillment_shadow_core_v1",
  "20260709120000_lf2_reservation_enums_v1",
  "20260709121000_lf2_reservation_delivery_attempt_v1",
]);

const migrations = await db.$queryRaw`
  SELECT migration_name, started_at, finished_at, applied_steps_count, logs, rolled_back_at
  FROM _prisma_migrations
  ORDER BY started_at ASC NULLS LAST, migration_name ASC
`;

const failed = migrations.filter((m) => m.rolled_back_at != null || (m.started_at && !m.finished_at));
const unfinished = migrations.filter((m) => m.started_at && !m.finished_at);

const lf2Tables = [
  "LeadEligibilityAssessment",
  "LeadAllocation",
  "DeliveryTarget",
  "DeliveryInstruction",
  "FulfillmentOutbox",
  "DeliveryAttempt",
];

const tableCheck = await db.$queryRaw`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = ANY(${lf2Tables})
  ORDER BY table_name
`;

const leadOrderCount = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM "LeadOrder"`;
const leadOrders = await db.$queryRaw`SELECT * FROM "LeadOrder" ORDER BY "createdAt" DESC LIMIT 5`;

const leadOrderCols = await db.$queryRaw`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'LeadOrder'
  ORDER BY ordinal_position
`;

const destCols = await db.$queryRaw`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'ClientGhlDestination'
    AND column_name IN ('sa360CustomFieldOptionMapJson', 'destinationSubaccountIdGhl', 'deliveryMode', 'deliveryEnabled')
  ORDER BY column_name
`;

const dbSize = await db.$queryRaw`
  SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
         current_database() AS database_name
`;

const connections = await db.$queryRaw`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE state = 'active')::int AS active,
         count(*) FILTER (WHERE state = 'idle')::int AS idle,
         count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
  FROM pg_stat_activity
  WHERE datname = current_database()
`;

const longQueries = await db.$queryRaw`
  SELECT pid, usename, state, wait_event_type, wait_event,
         left(query, 120) AS query_preview,
         now() - query_start AS duration
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
    AND state <> 'idle'
  ORDER BY query_start ASC
  LIMIT 10
`;

const locks = await db.$queryRaw`
  SELECT l.locktype, l.mode, c.relname AS relation, l.granted, count(*)::int AS count
  FROM pg_locks l
  LEFT JOIN pg_class c ON c.oid = l.relation
  WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
  GROUP BY l.locktype, l.mode, c.relname, l.granted
  ORDER BY count DESC
  LIMIT 15
`;

const appliedNames = new Set(migrations.map((m) => m.migration_name));
const repoMigrations = [
  "20260312144854_init",
  "20260422160000_add_inbound_contact_index",
  "20260430120000_add_webhook_request_log",
  "20260430221723_add_webhook_request_log",
  "20260430230000_add_synthflow_request_log",
  "20260430123000_add_synthflow_webhook_request_source",
  "20260505214853_synthflow_outbound_result_log",
  "20260511204049_add_kanban_board_and_card",
  "20260514180000_add_phase1_agent_workspace_guidance_models",
  "20260519120000_campaign_routing_registry",
  "20260528120000_routing_dry_run_validation",
  "20260529120000_shadow_delivery_plan",
  "20260530120000_delivery_readiness_config",
  "20260531120000_ghl_delivery_adapter_run",
  "20260531140000_lead_duplicate_risk_assessment",
  "20260531160000_ghl_live_delivery_canary",
  "20260531180000_ghl_location_connection",
  "20260519120000_ghl_oauth_pending_install",
  "20260520120000_ghl_location_config_snapshot",
  "20260601161852_add_client_onboarding_models",
  "20260601120000_client_ghl_custom_field_option_map",
  "20260601170000_reconcile_client_ghl_destination_option_map",
  "20260602120000_client_portal_login_email_unique",
  "20260604120000_add_support_tickets",
  "20260609120000_client_ghl_custom_field_mapping",
  "20260610120000_client_ghl_optional_post_contact_steps",
  "20260611120000_delivery_runtime_mode",
  "20260612120000_workflow_trigger_mode",
  "20260612180000_source_lead_intake",
  "20260615120000_source_field_enrichment",
  "20260616120000_leadcapture_webhook_linkage",
  "20260617120000_bulk_lead_import",
  "20260624120000_add_facebook_lead_ads_request_source",
  "20260625120000_client_channel_profile_config",
  "20260625160000_client_profile_ghl_mirror_log",
  "20260626120000_add_admin_runtime_settings",
  "20260626130000_add_google_sheets_request_source",
  "20260630163000_add_lf1_proof_vault_foundation",
  "20260701120000_lead_orders",
  "20260702103000_add_lead_cleanup_status_fields",
  "20260707182000_add_lead_proof_artifacts",
  "20260707230000_complete_lead_proof_artifact_fields",
  "20260708180000_fulfillment_shadow_core_v1",
  "20260709120000_lf2_reservation_enums_v1",
  "20260709121000_lf2_reservation_delivery_attempt_v1",
].sort();

const pendingFromLedger = repoMigrations.filter((m) => !appliedNames.has(m));
const unexpectedApplied = [...appliedNames].filter((m) => !repoMigrations.includes(m));

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      database: maskDbUrl(process.env.DATABASE_URL),
      dbSize: dbSize[0],
      migrationSummary: {
        appliedCount: migrations.length,
        repoTotal: repoMigrations.length,
        pendingExpected: [...pending],
        pendingFromLedger,
        pendingMatchesExpected:
          pendingFromLedger.length === 4 &&
          pendingFromLedger.every((m) => pending.has(m)),
        failedCount: failed.length,
        unfinishedCount: unfinished.length,
        unexpectedApplied,
      },
      migrations,
      failed,
      unfinished,
      lf2TablesFound: tableCheck,
      leadOrderCount: leadOrderCount[0]?.count,
      leadOrders,
      leadOrderFulfillmentColumns: leadOrderCols.filter((c) =>
        ["orderKind", "requestedQuantity", "reservedQuantity", "fulfilledQuantity"].includes(c.column_name)
      ),
      clientGhlDestinationKeyColumns: destCols,
      connections: connections[0],
      longQueries,
      locks,
    },
    null,
    2
  )
);

await db.$disconnect();
