-- Execute manually via privileged psql only after review of existing PostgreSQL instance.
-- The account must not be shared with DPES, Vision, or any existing application.
-- Use a secret set OUTSIDE this file, e.g. psql interactive \password interview_user.
CREATE ROLE interview_user LOGIN;
CREATE DATABASE interview_db OWNER interview_user;
-- Update the account password securely with psql's \password interview_user.
