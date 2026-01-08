const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// 環境変数 DATABASE_URL があればPostgreSQLモード、なければローカルJSONモード
const isPostgres = !!process.env.DATABASE_URL;

// ===== PostgreSQL 設定 =====
let pool;
if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // クラウドDB接続用
  });

  // テーブル初期化
  pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      display_order INTEGER NOT NULL,
      category TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      is_checkout INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `).catch(err => console.error('DB Init Error:', err));
}

// ===== JSON DB 設定 =====
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'rooms.json');

// 初期データ定義
const initialRooms = [
  // 本館 (一般客室)
  { room_id: '201', display_order: 100, category: 'general' },
  { room_id: '202', display_order: 110, category: 'general' },
  { room_id: '203', display_order: 120, category: 'general' },
  { room_id: '205', display_order: 130, category: 'general' },
  { room_id: '206', display_order: 140, category: 'general' },
  { room_id: '207', display_order: 150, category: 'general' },
  { room_id: '208', display_order: 160, category: 'general' },
  { room_id: '209', display_order: 170, category: 'general' },
  { room_id: '210', display_order: 180, category: 'general' },
  { room_id: '211', display_order: 190, category: 'general' },
  { room_id: '212', display_order: 200, category: 'general' },
  { room_id: '213', display_order: 210, category: 'general' },
  { room_id: '215', display_order: 220, category: 'general' },
  { room_id: '216', display_order: 230, category: 'general' },
  { room_id: '217', display_order: 240, category: 'general' },
  { room_id: '218', display_order: 250, category: 'general' },
  { room_id: '219', display_order: 260, category: 'general' },
  { room_id: '220', display_order: 270, category: 'general' },
  { room_id: '221', display_order: 280, category: 'general' },
  { room_id: '222', display_order: 290, category: 'general' },
  { room_id: '223', display_order: 300, category: 'general' },
  { room_id: '225', display_order: 310, category: 'general' },
  { room_id: '226-7', display_order: 320, category: 'general' },
  { room_id: '228', display_order: 330, category: 'general' },
  { room_id: '229', display_order: 340, category: 'general' },
  // 別館 (特別室)
  { room_id: '松虫草', display_order: 900, category: 'special' },
  { room_id: '翁草', display_order: 910, category: 'special' },
  { room_id: '笹百合', display_order: 920, category: 'special' },
  { room_id: '寒椿', display_order: 930, category: 'special' },
].map(r => ({
  ...r,
  is_active: 0,
  is_checkout: 0,
  notes: '',
  updated_at: new Date().toISOString()
}));

// ローカルDB操作用ヘルパー
function loadLocalDB() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.rooms || [];
    }
  } catch (err) { console.error('Local DB Load Error', err); }
  return [...initialRooms];
}

function saveLocalDB(rooms) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify({ rooms }, null, 2), 'utf8');
  } catch (err) { console.error('Local DB Save Error', err); }
}

let localCache = loadLocalDB();

// ===== エクスポート関数 =====
module.exports = {
  // 全部屋取得
  getAllRooms: () => {
    if (isPostgres) {
      // Postgres: 非同期だが、better-sqlite3互換のためここで同期風に見せるのは無理
      // なのでServer側でPromise対応が必要。Server.jsも修正する。
      // ただし、今回はPromiseを返すようにしてServer側でawaitさせる形に変える。
      return pool.query('SELECT * FROM rooms ORDER BY display_order ASC')
        .then(res => {
          if (res.rows.length === 0) {
            // 初期データ投入
            const values = initialRooms.map(r =>
              `('${r.room_id}', ${r.display_order}, '${r.category}', 0, 0, '', NOW())`
            ).join(',');
            return pool.query(`INSERT INTO rooms (room_id, display_order, category, is_active, is_checkout, notes, updated_at) VALUES ${values} RETURNING *`)
              .then(r => r.rows.sort((a, b) => a.display_order - b.display_order));
          }
          return res.rows;
        });
    } else {
      // JSON
      return Promise.resolve(localCache.sort((a, b) => a.display_order - b.display_order));
    }
  },

  // 単一部屋取得
  getRoom: (roomId) => {
    if (isPostgres) {
      return pool.query('SELECT * FROM rooms WHERE room_id = $1', [roomId])
        .then(res => res.rows[0]);
    } else {
      return Promise.resolve(localCache.find(r => r.room_id === roomId));
    }
  },

  // 更新
  updateRoom: (roomId, updates) => {
    if (isPostgres) {
      const keys = Object.keys(updates).filter(k => ['is_active', 'is_checkout', 'notes'].includes(k));
      if (keys.length === 0) return Promise.resolve(null);

      const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const values = [roomId, ...keys.map(k => updates[k])];

      return pool.query(`UPDATE rooms SET ${setClause}, updated_at = NOW() WHERE room_id = $1 RETURNING *`, values)
        .then(res => res.rows[0]);
    } else {
      const idx = localCache.findIndex(r => r.room_id === roomId);
      if (idx === -1) return Promise.resolve(null);

      Object.assign(localCache[idx], updates);
      localCache[idx].updated_at = new Date().toISOString();
      saveLocalDB(localCache);
      return Promise.resolve(localCache[idx]);
    }
  },

  // リセット
  resetAllRooms: () => {
    if (isPostgres) {
      return pool.query(`UPDATE rooms SET is_active = 0, is_checkout = 0, notes = '', updated_at = NOW() RETURNING *`)
        .then(res => res.rows);
    } else {
      localCache = localCache.map(r => ({
        ...r,
        is_active: 0,
        is_checkout: 0,
        notes: '',
        updated_at: new Date().toISOString()
      }));
      saveLocalDB(localCache);
      return Promise.resolve(localCache);
    }
  },

  close: () => {
    if (isPostgres) pool.end();
  }
};
