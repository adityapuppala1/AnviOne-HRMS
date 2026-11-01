-- POL-01: a published version that is later withdrawn keeps the date it was published.
-- A draft never has one; published, superseded and withdrawn-after-publishing versions do.
ALTER TABLE policy_version DROP CONSTRAINT policy_version_check;
ALTER TABLE policy_version ADD CONSTRAINT policy_version_published_at_check CHECK(
 (status='draft' AND published_at IS NULL)
 OR (status IN ('published','superseded') AND published_at IS NOT NULL)
 OR status='withdrawn'
);
