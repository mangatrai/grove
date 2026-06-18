-- RE-1: Add photo_url column to property for quick thumbnail access without JSONB parsing
ALTER TABLE property ADD COLUMN IF NOT EXISTS photo_url TEXT;
