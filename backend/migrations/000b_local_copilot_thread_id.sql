-- Local-dev only: copilot.py inserts a thread_id that no migration
-- creates. Pre-existing schema drift, unrelated to the Ollama migration.
ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS thread_id UUID;
