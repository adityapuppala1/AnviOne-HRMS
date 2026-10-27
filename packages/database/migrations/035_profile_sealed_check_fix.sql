-- PRF-01 fix: PostgreSQL regular expressions allow at most 255 repetitions, so 034's
-- '{40,1200}' bound failed on every sealed value. Check the alphabet and the length separately.
CREATE OR REPLACE FUNCTION profile_sealed_ok(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT v IS NULL OR (char_length(v) BETWEEN 40 AND 1200 AND v ~ '^[A-Za-z0-9_-]+$');
$$;
