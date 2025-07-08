-- This file is executed when PostgreSQL container starts
-- Check if database exists and create if it doesn't

-- First connect to postgres database to check
\c postgres;

-- Create database if it doesn't exist
SELECT 'CREATE DATABASE teak_db' 
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'teak_db')\gexec

-- Now connect to our database
\c teak_db;

-- Create any initial setup if needed
-- The actual schema will be created by Drizzle migrations

-- Grant permissions to user
GRANT ALL PRIVILEGES ON DATABASE teak_db TO teak_user;
GRANT ALL ON SCHEMA public TO teak_user;

-- Log successful initialization
SELECT 'Database teak_db initialized successfully!' as message;