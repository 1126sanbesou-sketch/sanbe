const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// セキュアなアプリケーションID（サーバー起動時に生成）
const APP_SECRET = process.env.APP_SECRET || uuidv4();

// SSE クライアント管理
const sseClients = new Set();

// ミドルウェア
app.use(express.json());

// 簡易認証ミドルウェア
app.use((req, res, next) => {
    // 認証対象外のパス
    const publicPaths = ['/login.html', '/styles.css', '/api/login'];
    if (publicPaths.includes(req.path) || req.path.startsWith('/app/v1')) {
        return next();
    }

    // クッキーから認証トークンを確認
    const cookies = req.headers.cookie;
    const isAuthenticated = cookies && cookies.includes('auth_token=valid_1126');

    if (isAuthenticated) {
        return next();
    }

    // 認証失敗時の処理
    if (req.path.startsWith('/api/')) {
        // APIの場合は401
        res.status(401).json({ error: '認証が必要です' });
    } else {
        // それ以外はログイン画面へリダイレクト
        res.redirect('/login.html');
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// SSE ブロードキャスト関数
function broadcast(eventType, data) {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        client.write(message);
    });
}

// ===== API エンドポイント =====

// ログインAPI
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === '1126') {
        // 簡易的な認証クッキーを設定 (30日間有効)
        res.setHeader('Set-Cookie', 'auth_token=valid_1126; Path=/; Max-Age=2592000; HttpOnly');
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'パスワードが違います' });
    }
});

// SSE エンドポイント（リアルタイム同期）
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 接続確認
    res.write('event: connected\ndata: {"status":"ok"}\n\n');

    // クライアント登録
    sseClients.add(res);

    // 接続終了時のクリーンアップ
    req.on('close', () => {
        sseClients.delete(res);
    });
});

// 全部屋取得
app.get('/api/rooms', async (req, res) => {
    try {
        const rooms = await db.getAllRooms();
        res.json(rooms);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// 単一部屋取得
app.get('/api/rooms/:roomId', async (req, res) => {
    try {
        const room = await db.getRoom(req.params.roomId);
        if (room) {
            res.json(room);
        } else {
            res.status(404).json({ error: '部屋が見つかりません' });
        }
    } catch (error) {
        console.error('Error fetching room:', error);
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// 部屋情報更新（PATCH - フィールド単位）
app.patch('/api/rooms/:roomId', async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const updates = req.body;

        const updatedRoom = await db.updateRoom(roomId, updates);

        if (updatedRoom) {
            // 全クライアントにブロードキャスト
            broadcast('roomUpdate', updatedRoom);
            res.json(updatedRoom);
        } else {
            res.status(404).json({ error: '部屋が見つかりません' });
        }
    } catch (error) {
        console.error('Error updating room:', error);
        res.status(500).json({ error: '更新に失敗しました' });
    }
});

// 全ステータスリセット（管理者用）
app.post('/api/reset', async (req, res) => {
    try {
        await db.resetAllRooms();
        // 最新状態を取得
        const rooms = await db.getAllRooms();

        // 全クライアントにブロードキャスト
        broadcast('reset', rooms);

        res.json({ success: true, message: '全ステータスをリセットしました' });
    } catch (error) {
        console.error('Error resetting rooms:', error);
        res.status(500).json({ error: 'リセットに失敗しました' });
    }
});

// セキュアURL用ルート
app.get('/app/v1/hotel-ops/share/:secret', (req, res) => {
    // 本番環境ではシークレットの検証を行う
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ルートへのアクセス
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ローカルIPアドレスを取得
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// localtunnelでインターネット公開
async function startTunnel() {
    try {
        const localtunnel = require('localtunnel');
        const tunnel = await localtunnel({ port: PORT });

        console.log(`
║  🌐 インターネット公開URL（どこからでもアクセス可能）:   ║
║  ${tunnel.url}
╚═══════════════════════════════════════════════════════════╝
    `);

        tunnel.on('close', () => {
            console.log('トンネルが閉じられました');
        });

        tunnel.on('error', (err) => {
            console.error('トンネルエラー:', err);
        });
    } catch (error) {
        console.error('トンネル作成に失敗しました:', error.message);
        console.log('ローカルネットワークからのみアクセス可能です。');
    }
}

// サーバー起動（ローカル実行時のみ）
if (require.main === module) {
    const localIP = getLocalIP();
    // サーバー起動（0.0.0.0 = 全ネットワークインターフェースでリッスン）
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║     🏨 客室チェックアウト・清掃管理システム               ║
╠═══════════════════════════════════════════════════════════╣
║  サーバーが起動しました！                                 ║
║                                                           ║
║  📱 同一Wi-Fi内からアクセス:                              ║
║  http://${localIP}:${PORT}
║                                                           ║
║  💻 このPCからアクセス:                                   ║
║  http://localhost:${PORT}
╠═══════════════════════════════════════════════════════════╣`);

        // トンネル開始
        startTunnel();
    });
}

// Vercel用にエクスポート
module.exports = app;

// 終了時のクリーンアップ
process.on('SIGINT', () => {
    console.log('\nサーバーを終了しています...');
    db.close();
    process.exit(0);
});
