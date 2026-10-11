-- REVIEW ONLY. Requires explicit approval before running on a shared PostgreSQL instance.
-- Provision exclusively for this application; set the password interactively OUTSIDE this file.
CREATE ROLE interview_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE interview_db OWNER interview_user;
-- In psql: \password interview_user (never paste the plaintext into chat or Git).
-- Connect to interview_db and restrict its public schema to its owner:
-- REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- GRANT USAGE, CREATE ON SCHEMA public TO interview_user;
-- Do not alter existing databases, roles, grants or application secrets.
