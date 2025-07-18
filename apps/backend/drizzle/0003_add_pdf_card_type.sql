-- Add 'pdf' to the cardType enum
ALTER TYPE "public"."cardType" ADD VALUE 'pdf';

-- Update the full-text search index to include PDF extracted_text
DROP INDEX IF EXISTS idx_cards_data_fts;
CREATE INDEX idx_cards_data_fts ON cards
USING GIN (
  to_tsvector(
    'english',
    COALESCE(data->>'content', '') || ' ' ||
    COALESCE(data->>'url', '') || ' ' ||
    COALESCE(data->>'transcription', '') || ' ' ||
    COALESCE(data->>'subtitles', '') || ' ' ||
    COALESCE(data->>'extracted_text', '')
  )
);