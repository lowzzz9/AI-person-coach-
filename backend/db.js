'use strict';

const { Pool } = require('pg');
const { newDb } = require('pg-mem');

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function createPool() {
  if (hasDatabaseUrl) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }

  // Local development fallback: pure JavaScript, PostgreSQL-compatible, and non-persistent.
  // Production always supplies DATABASE_URL and therefore uses real PostgreSQL.
  const memoryDb = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memoryDb.adapters.createPg();
  return new adapter.Pool();
}

const pool = createPool();

const database = {
  kind: 'postgres',
  mode: hasDatabaseUrl ? 'postgres' : 'memory',
  pool,
  run: async (sql, params = []) => {
    const result = await pool.query(postgresSql(sql), params);
    return { changes: result.rowCount };
  },
  insert: async (sql, params = []) => {
    const result = await pool.query(`${postgresSql(sql)} RETURNING id`, params);
    return { lastID: result.rows[0].id, changes: result.rowCount };
  },
  get: async (sql, params = []) => (await pool.query(postgresSql(sql), params)).rows[0],
  all: async (sql, params = []) => (await pool.query(postgresSql(sql), params)).rows,
  close: () => pool.end()
};

const dbReady = (async () => {
  await pool.query('SELECT 1');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workout_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      exercise_name TEXT,
      reps INTEGER,
      sets_completed INTEGER,
      calories DOUBLE PRECISION,
      form_score DOUBLE PRECISION,
      workout_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_date
    ON workout_sessions (user_id, workout_date DESC);
  `);
})();

module.exports = { database, dbReady };
