-- Local-dev only: copilot.py saves the assistant reply with a model_used
-- value that no migration creates a column for. Pre-existing schema
-- drift, unrelated to the Ollama migration.
ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS model_used TEXT;
