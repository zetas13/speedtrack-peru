-- Modelo conceptual para futura migración. No se ejecuta en el prototipo.
create table users (id uuid primary key, name text, email text, language text, voice_enabled boolean);
create table sessions (id uuid primary key, user_id uuid references users, type text, start_time timestamptz, end_time timestamptz, distance double precision, duration double precision, avg_speed double precision, max_speed double precision, max_acceleration double precision, max_deceleration double precision, demo boolean, speed_limit double precision, above_limit double precision, goal double precision);
create table measurements (id uuid primary key, session_id uuid references sessions, timestamp timestamptz, elapsed double precision, latitude double precision, longitude double precision, speed double precision, acceleration double precision, accuracy double precision, distance double precision);
create table events (id uuid primary key, session_id uuid references sessions, timestamp timestamptz, elapsed double precision, type text, value double precision);
create table splits (id uuid primary key, session_id uuid references sessions, kilometer integer, time double precision, pace double precision);
create table settings (id uuid primary key, user_id uuid references users, language text, units text, voice_enabled boolean, voice_language text, voice_volume double precision, kilometer_alerts boolean, safety_alerts boolean, approaching_alerts boolean, speed_limit double precision);
-- Antes de conectar Supabase: configurar autenticación, RLS y políticas por user_id.
