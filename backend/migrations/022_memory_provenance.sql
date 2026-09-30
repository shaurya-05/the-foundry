-- ─── V-11: make the memory provenance guarantee structural ──────────────────
-- The Foundation brief: "The provenance guarantee is absolute: no code path may
-- write memory without a declared `source`."
--
-- It was not absolute. It was not even enforced. `015_agent_memory.sql` stores a
-- JSONB array with `source` inside each element and says so in its own comment:
-- "enforced by the loop once it exists, not by this table". Proven against the
-- live database in Stage 4 -- this was accepted without complaint:
--
--     INSERT INTO agent_memory (workspace_id, user_id, content)
--     VALUES (..., '[{"text":"a memory with NO source at all"}]'::jsonb);
--
-- So provenance held exactly as long as every writer went through
-- memory_tool.py. One does today. That is a convention. The audit log gets a
-- trigger, built-in roles get a trigger; this got a comment.
--
-- It matters most for Stage 5, which is explicitly told that compaction must
-- not become a backdoor around provenance. With nothing structural, a compactor
-- writing a merged entry without `source` simply succeeds and nothing notices.

-- A CHECK constraint cannot contain a subquery, so the test lives in an
-- IMMUTABLE function. jsonb_array_elements over a parameter is not a table
-- subquery, so this is legal inside CHECK.
CREATE OR REPLACE FUNCTION agent_memory_provenance_ok(content jsonb)
RETURNS boolean AS $$
    SELECT jsonb_typeof(content) = 'array'
       AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(content) AS entry
           WHERE (entry->>'source') IS NULL
              OR (entry->>'source') NOT IN
                 ('user_stated', 'agent_inferred', 'conversation_digest')
       );
$$ LANGUAGE sql IMMUTABLE;

-- NOT VALID deliberately.
--
-- NOT VALID still enforces the constraint on every INSERT and UPDATE from this
-- point on -- which is the actual goal. What it skips is the retroactive scan
-- of existing rows, so this migration cannot fail on a live database that
-- already contains provenance-free entries written during the years when
-- nothing was stopping them.
--
-- A migration that refuses to apply to production is not a safety feature; it
-- is an outage. Legacy rows are a data-cleanup question, and running
-- `ALTER TABLE agent_memory VALIDATE CONSTRAINT agent_memory_provenance_required`
-- once they are clean is what closes it. On a fresh database there are no rows,
-- so the constraint is fully valid from the first moment.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_memory_provenance_required'
    ) THEN
        ALTER TABLE agent_memory
            ADD CONSTRAINT agent_memory_provenance_required
            CHECK (agent_memory_provenance_ok(content)) NOT VALID;
    END IF;
END $$;

COMMENT ON CONSTRAINT agent_memory_provenance_required ON agent_memory IS
    'V-11: every memory entry must declare a recognised source. Enforced here '
    'rather than in application code so that a second writer -- including a '
    'future compactor -- cannot bypass it.';
