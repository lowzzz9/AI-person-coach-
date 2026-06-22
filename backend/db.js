'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'database.db');
const sessionDbPath = path.join(dataDir, 'sessions.db');
const isPostgres = Boolean(process.env.DATABASE_URL);

function sqliteRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function sqliteGet(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function postgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

let database;
let dbReady;

if (isPostgres) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  database = {
    kind: 'postgres',
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

  dbReady = (async () => {
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
} else {
  // Keep the native SQLite module out of the production/PostgreSQL load path.
  const sqlite3 = require('sqlite3').verbose();
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new sqlite3.Database(dbPath);

  database = {
    kind: 'sqlite',
    db: sqlite,
    run: (sql, params = []) => sqliteRun(sqlite, sql, params),
    insert: (sql, params = []) => sqliteRun(sqlite, sql, params),
    get: (sql, params = []) => sqliteGet(sqlite, sql, params),
    all: (sql, params = []) => sqliteAll(sqlite, sql, params),
    close: () => new Promise((resolve, reject) => sqlite.close(error => error ? reject(error) : resolve()))
  };

  dbReady = new Promise((resolve, reject) => {
    sqlite.serialize(() => {
      sqlite.run('PRAGMA foreign_keys = ON');
      sqlite.run('PRAGMA journal_mode = WAL');
      sqlite.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, error => {
        if (error) return reject(error);
        sqlite.all('PRAGMA table_info(users)', (columnsError, columns) => {
          if (columnsError) return reject(columnsError);
          const hasEmail = columns.some(column => column.name === 'email');
          const finish = migrationError => {
            if (migrationError) return reject(migrationError);
            sqlite.exec(`
              CREATE TABLE IF NOT EXISTS workout_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                exercise_name TEXT,
                reps INTEGER,
                sets_completed INTEGER,
                calories REAL,
                form_score REAL,
                workout_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
              );
              CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_date
              ON workout_sessions (user_id, workout_date DESC);
            `, execError => execError ? reject(execError) : resolve());
          };
          if (hasEmail) return finish();
          sqlite.run('ALTER TABLE users ADD COLUMN email TEXT', migrationError => {
            if (migrationError) return finish(migrationError);
            sqlite.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)', finish);
          });
        });
      });
    });
  });
}

module.exports = { database, dbPath, sessionDbPath, dbReady };
