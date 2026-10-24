ALTER TABLE "identity"."refresh_tokens" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."refresh_tokens" ADD COLUMN "grace_used_at" timestamp with time zone;
--> statement-breakpoint
COMMENT ON COLUMN identity.refresh_tokens.used_at IS 'When this token was consumed by a successful rotation.';
--> statement-breakpoint
COMMENT ON COLUMN identity.refresh_tokens.grace_used_at IS 'When a 20s grace replay of this token was honoured (once).';
