const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Expose the frontend directory (sibling folder to backend)
app.use(express.static(path.join(__dirname, '../frontend')));

const dbPath = path.join(__dirname, 'cafe.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database error:', err.message);
    else console.log("SQLite connected successfully");
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let wsClients = [];

wss.on('connection', (ws) => {
    wsClients.push(ws);
    ws.on('close', () => { wsClients = wsClients.filter(client => client !== ws); });
});

function broadcast(data) {
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(data)); }
    });
}

/* ===============================
   DATABASE INITIALIZATION & STRICT SEEDING
================================= */
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, pin TEXT, is_archived INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category_id TEXT, price REAL NOT NULL, unit_of_measure TEXT NOT NULL, tax REAL DEFAULT 0, description TEXT, stock INTEGER DEFAULT 100, FOREIGN KEY(category_id) REFERENCES categories(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, floor_name TEXT NOT NULL, table_number TEXT NOT NULL, seats INTEGER NOT NULL, status TEXT DEFAULT 'Available', is_active INTEGER DEFAULT 1)`);
    db.run(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, loyalty_points INTEGER DEFAULT 0, visit_count INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT NOT NULL, value REAL NOT NULL, min_threshold REAL DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS automated_promotions (id TEXT PRIMARY KEY, name TEXT NOT NULL, trigger_type TEXT NOT NULL, product_id TEXT, min_quantity INTEGER DEFAULT 0, min_amount REAL DEFAULT 0, discount_type TEXT NOT NULL, discount_value REAL NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS payment_methods (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, enabled INTEGER DEFAULT 1, upi_id TEXT DEFAULT '')`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, opened_by TEXT, open_date TEXT, close_date TEXT, closing_sales REAL DEFAULT 0, status TEXT DEFAULT 'Closed')`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, table_id TEXT, customer_id TEXT, subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL DEFAULT 0, status TEXT DEFAULT 'Draft', kds_status TEXT DEFAULT 'To Cook', payment_method TEXT, transaction_ref TEXT, amount_received REAL DEFAULT 0, change_due REAL DEFAULT 0, created_at TEXT, employee_name TEXT, session_id TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, product_name TEXT, quantity INTEGER, unit_price REAL, line_total REAL, is_cooked INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, product_id TEXT UNIQUE, current_stock INTEGER DEFAULT 100, low_stock_threshold INTEGER DEFAULT 10)`);

    // Force strictly synchronized seating plan execution
    db.get("SELECT COUNT(*) as count FROM tables", (err, row) => {
        if (row && row.count === 0) {
            const insertTable = db.prepare(`INSERT INTO tables (id, floor_name, table_number, seats, status, is_active) VALUES (?, ?, ?, ?, 'Available', 1)`);
            insertTable.run('TBL-01', 'Floor 1', 'Table 01', 4);
            insertTable.run('TBL-02', 'Floor 1', 'Table 02', 2);
            insertTable.run('TBL-03', 'Floor 1', 'Table 03', 4);
            insertTable.run('TBL-04', 'Floor 2', 'Table 04', 6);
            insertTable.run('TBL-05', 'Floor 2', 'Table 05', 4);
            insertTable.run('TBL-06', 'Terrace', 'Table 06', 2);
            insertTable.run('TBL-07', 'Terrace', 'Table 07', 4);
            insertTable.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
        if (row && row.count === 0) {
            const cat1 = 'CAT-COFFEE', cat2 = 'CAT-BAKERY', cat3 = 'CAT-SNACKS';
            
            // Set unity $hop gradient themes explicitly
            db.run(`INSERT INTO categories VALUES ('${cat1}', 'Coffee Bar', '#8b5cf6')`);
            db.run(`INSERT INTO categories VALUES ('${cat2}', 'Fresh Bakery', '#ec4899')`);
            db.run(`INSERT INTO categories VALUES ('${cat3}', 'Quick Snacks', '#f59e0b')`);

            const insertProd = db.prepare(`INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            insertProd.run('PROD-01', 'Almond Tart', cat2, 4.20, 'PER PIECE', 5, 'Crisp pastry crust filled with toasted almond cream', 100);
            insertProd.run('PROD-02', 'Blueberry Cheesecake', cat2, 6.50, 'PER SLICE', 5, 'Creamy New York cheesecake topped with sweet blueberries', 100);
            insertProd.run('PROD-03', 'Butter Croissant', cat2, 4.00, 'PER PIECE', 5, 'Flaky, hot oven-baked traditional French pastry', 100);
            insertProd.run('PROD-04', 'Caramel Macchiato', cat1, 5.20, 'PER CUP', 5, 'Espresso with rich vanilla syrup and caramel drizzle', 100);
            insertProd.run('PROD-05', 'Chocolate Muffin', cat2, 3.80, 'PER PIECE', 5, 'Rich double chocolate muffin loaded with dark chips', 100);
            insertProd.run('PROD-06', 'Club Sandwich', cat3, 7.50, 'PER SERVING', 5, 'Classic double-decker toasted bread filled with chicken', 100);
            insertProd.run('PROD-07', 'Espresso Blend', cat1, 3.50, 'PER CUP', 5, 'Rich aroma premium double shot dark roast espresso', 100);
            insertProd.run('PROD-08', 'French Fries Basket', cat3, 3.90, 'PER SERVING', 5, 'Golden crispy potatoes served with hot garlic mayo dip', 100);
            insertProd.run('PROD-09', 'Garlic Bread Stix', cat3, 4.50, 'PER SERVING', 5, 'Toasted artisan bread rubbed with rich garlic herb butter', 100);
            insertProd.run('PROD-10', 'Iced Latte', cat1, 4.50, 'PER CUP', 5, 'Chilled signature espresso balanced over fresh cold milk', 100);
            insertProd.run('PROD-11', 'Loaded Nachos', cat3, 8.20, 'PER SERVING', 5, 'Crisp tortilla chips smothered in cheddar, jalapenos, and salsa', 100);
            insertProd.run('PROD-12', 'Vanilla Cappuccino', cat1, 4.80, 'PER CUP', 5, 'Classic steamed milk foam layered with vanilla espresso', 100);
            insertProd.finalize();
        }
    });

    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO users VALUES ('USR-ROOT01', 'Admin Owner', 'admin@shop.com', 'admin123', 'admin', '1111', 0)`);
            db.run(`INSERT INTO users VALUES ('USR-CASH01', 'Cafe Cashier', 'cashier@shop.com', 'cashier123', 'pos', '2222', 0)`);
        }
    });

    db.get("SELECT COUNT(*) as count FROM payment_methods", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO payment_methods VALUES ('PAY-1', 'Cash', 1, '')`);
            db.run(`INSERT INTO payment_methods VALUES ('PAY-2', 'Card', 1, '')`);
            db.run(`INSERT INTO payment_methods VALUES ('PAY-3', 'UPI QR', 1, 'unityshop@upi')`);
        }
    });

    console.log("Database schema structured and synchronously seeded.");
});

/* ==========================================
   AUTHENTICATION & SECURITY PROFILE MANAGEMENT
========================================== */
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ? AND password = ? AND is_archived = 0`, [email?.trim().toLowerCase(), password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Invalid credentials" });
        res.json({ success: true, name: user.name, role: user.role, user_id: user.id });
    });
});

app.post('/api/sessions/open', (req, res) => {
    const { opened_by } = req.body;
    const id = "SESS-" + uuidv4().substring(0, 8);
    db.run(`INSERT INTO sessions (id, opened_by, open_date, status) VALUES (?, ?, ?, 'Open')`, [id, opened_by || '', new Date().toISOString()], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, session_id: id });
    });
});

app.get('/api/sessions/latest', (req, res) => {
    db.get(`SELECT * FROM sessions WHERE status='Closed' ORDER BY close_date DESC LIMIT 1`, [], (err, row) => {
        if (!row) return res.json({ open_date: null, close_date: null, closing_sales: 0 });
        res.json(row);
    });
});

app.post('/api/sessions/close/:id', (req, res) => {
    const sessionId = req.params.id;
    db.all(`SELECT * FROM orders WHERE session_id=? AND status='Paid'`, [sessionId], (err, rows) => {
        const closingSales = (rows || []).reduce((sum, o) => sum + (o.total || 0), 0);
        db.run(`UPDATE sessions SET close_date=?, closing_sales=?, status='Closed' WHERE id=?`, [new Date().toISOString(), closingSales, sessionId], (err2) => {
            res.json({ success: true, closing_sales: closingSales });
        });
    });
});

/* ==========================================
   TEAM DIRECTORY PORTS
========================================== */
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, name, email, password, role, pin, is_archived FROM users WHERE is_archived = 0`, [], (err, rows) => res.json(rows || []));
});

app.post('/api/users', (req, res) => {
    const { name, email, password, role, pin } = req.body;
    const id = "USR-" + uuidv4().substring(0, 8);
    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 0)`, [id, name||'New User', email||'', password||'', role || "pos", pin || null], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        broadcast({ type: "TEAM_UPDATE" }); res.json({ success: true, user_id: id });
    });
});

app.put('/api/users/:id', (req, res) => {
    const { name, email, password, role, pin } = req.body;
    db.run(`UPDATE users SET name=?, email=?, password=?, role=?, pin=? WHERE id=?`, [name, email, password, role, pin, req.params.id], (err) => {
        broadcast({ type: "TEAM_UPDATE" }); res.json({ success: true });
    });
});

app.delete('/api/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id=?`, [req.params.id], (err) => { broadcast({ type: "TEAM_UPDATE" }); res.json({ success: true }); });
});

/* ==========================================
   CATEGORY & PRODUCT PORTS
========================================== */
app.get('/api/categories', (req, res) => {
    db.all(`SELECT * FROM categories ORDER BY name ASC`, [], (err, rows) => res.json(rows || []));
});

app.post('/api/categories', (req, res) => {
    const { name, color } = req.body;
    const categoryId = "CAT-" + uuidv4().substring(0, 8);
    db.run(`INSERT INTO categories VALUES (?, ?, ?)`, [categoryId, name||'New Category', color || "#8B5CF6"], (err) => {
        if(err) return res.status(400).json({ error: err.message });
        broadcast({ type: "MENU_UPDATE" }); res.json({ success: true, category_id: categoryId });
    });
});

app.delete('/api/categories/:id', (req, res) => {
    db.run(`DELETE FROM categories WHERE id=?`, [req.params.id], () => { broadcast({ type: "MENU_UPDATE" }); res.json({ success: true }); });
});

app.get('/api/products', (req, res) => {
    db.all(`SELECT p.*, c.name as category_name, c.color as category_color FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.name ASC`, [], (err, rows) => res.json(rows || []));
});

app.post('/api/products', (req, res) => {
    const { name, category_id, price, unit_of_measure, tax, description, stock } = req.body;
    const productId = "PROD-" + uuidv4().substring(0, 8);
    db.run(`INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [productId, name||'Unnamed', category_id||'', parseFloat(price)||0, unit_of_measure||"Unit", parseFloat(tax)||0, description||"", parseInt(stock)||100], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        broadcast({ type: "MENU_UPDATE" }); res.json({ success: true, product_id: productId });
    });
});

app.put('/api/products/:id', (req, res) => {
    const { name, category_id, price, unit_of_measure, tax, description, stock } = req.body;
    db.run(`UPDATE products SET name=?, category_id=?, price=?, unit_of_measure=?, tax=?, description=?, stock=? WHERE id=?`, [name, category_id, parseFloat(price)||0, unit_of_measure, parseFloat(tax)||0, description, parseInt(stock)||100, req.params.id], () => {
        broadcast({ type: "MENU_UPDATE" }); res.json({ success: true });
    });
});

app.delete('/api/products/:id', (req, res) => {
    db.run(`DELETE FROM products WHERE id=?`, [req.params.id], () => { broadcast({ type: "MENU_UPDATE" }); res.json({ success: true }); });
});

/* ==========================================
   PROMOTIONS AND VOUCHERS PORTS
========================================== */
app.get('/api/promotions', (req, res) => { db.all(`SELECT * FROM automated_promotions`, [], (err, rows) => res.json(rows || [])); });
app.post('/api/promotions', (req, res) => {
    const { name, trigger_type, product_id, min_quantity, min_amount, discount_type, discount_value } = req.body;
    db.run(`INSERT INTO automated_promotions VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ["PROMO-" + uuidv4().substring(0, 8), name||"Promo", trigger_type, product_id||'', parseInt(min_quantity||0), parseFloat(min_amount||0), discount_type, parseFloat(discount_value||0)], (err) => { 
        if(err) return res.status(400).json({error: err.message});
        broadcast({ type: "MENU_UPDATE" }); res.json({success:true}); 
    });
});
app.delete('/api/promotions/:id', (req, res) => { db.run(`DELETE FROM automated_promotions WHERE id=?`, [req.params.id], () => { broadcast({ type: "MENU_UPDATE" }); res.json({success:true}); }); });

app.get('/api/coupons', (req, res) => { db.all(`SELECT * FROM coupons`, [], (err, rows) => res.json(rows || [])); });
app.post('/api/coupons', (req, res) => {
    const { code, type, value, min_threshold } = req.body;
    db.run(`INSERT INTO coupons VALUES (?, ?, ?, ?, ?)`, ["CPN-" + uuidv4().substring(0, 8), (code||'').toUpperCase(), type, parseFloat(value||0), parseFloat(min_threshold||0)], (err) => { 
        if(err) return res.status(400).json({error: err.message});
        broadcast({ type: "MENU_UPDATE" }); res.json({success:true}); 
    });
});
app.delete('/api/coupons/:id', (req, res) => { db.run(`DELETE FROM coupons WHERE id=?`, [req.params.id], () => { broadcast({ type: "MENU_UPDATE" }); res.json({success:true}); }); });

app.post('/api/coupons/validate', (req, res) => {
    const { code, order_total } = req.body;
    db.get(`SELECT * FROM coupons WHERE code=?`, [code], (err, coupon) => {
        if (!coupon) return res.status(404).json({ valid: false, error: "Voucher code not found" });
        if (order_total < coupon.min_threshold) return res.status(400).json({ valid: false, error: `Minimum spend of $${coupon.min_threshold} required` });
        res.json({ valid: true, coupon });
    });
});

/* ==========================================
   ORDER LOGISTICS
========================================== */
app.get('/api/tables', (req, res) => { db.all(`SELECT * FROM tables ORDER BY table_number ASC`, [], (err, rows) => res.json(rows || [])); });
app.get('/api/orders/active-drafts', (req, res) => { db.all(`SELECT * FROM orders WHERE status='Draft'`, [], (err, rows) => res.json(rows || [])); });
app.get('/api/analytics/filtered', (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, [], (err, rows) => {
        if (!rows || !rows.length) return res.json([]);
        let pending = rows.length;
        rows.forEach(order => {
            db.all(`SELECT * FROM order_items WHERE order_id=?`, [order.id], (err2, items) => {
                order.items = items || [];
                if (--pending === 0) res.json(rows);
            });
        });
    });
});
app.get('/api/orders', (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, [], (err, rows) => res.json(rows || []));
});

app.get('/api/orders/:id', (req, res) => {
    db.get(`SELECT * FROM orders WHERE id=?`, [req.params.id], (err, order) => {
        if (!order) return res.status(404).json({ error: "Order not found" });
        db.all(`SELECT * FROM order_items WHERE order_id=?`, [req.params.id], (err2, items) => {
            order.items = items || [];
            res.json(order);
        });
    });
});

app.delete('/api/orders/:id', (req, res) => {
    db.run(`DELETE FROM order_items WHERE order_id=?`, [req.params.id], () => {
        db.run(`DELETE FROM orders WHERE id=?`, [req.params.id], () => {
            broadcast({ type: "KDS_UPDATE" });
            res.json({ success: true });
        });
    });
});

app.post('/api/orders', (req, res) => {
    const { id, table_id, customer_id, items, subtotal, tax, discount, total, status, employee_name, session_id, payment_method, transaction_ref, amount_received } = req.body;
    const targetOrderId = id || "ORD-" + uuidv4().substring(0, 8);
    const orderNumber = "ORDER-" + Math.floor(10000 + Math.random() * 90000);
    const changeDue = (amount_received || 0) - (total || 0);
    db.run(
        `INSERT OR REPLACE INTO orders (id, order_number, table_id, customer_id, subtotal, tax, discount, total, status, kds_status, payment_method, transaction_ref, amount_received, change_due, created_at, employee_name, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [targetOrderId, orderNumber, table_id, customer_id || null, subtotal, tax, discount, total, status, (status === 'Paid' ? 'Completed' : 'To Cook'), payment_method || null, transaction_ref || null, amount_received || 0, Math.max(0, changeDue), new Date().toISOString(), employee_name || 'Master Barista', session_id || 'SESS-MOCK'],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`DELETE FROM order_items WHERE order_id=?`, [targetOrderId], () => {
                let stmt = db.prepare(`INSERT INTO order_items VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
                items.forEach(item => stmt.run(["ITEM-" + uuidv4().substring(0, 8), targetOrderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.line_total]));
                stmt.finalize();
                broadcast({ type: "KDS_UPDATE" });
                res.json({ success: true, order_id: targetOrderId });
            });
        }
    );
});
app.get('/api/payment-methods', (req, res) => db.all(`SELECT * FROM payment_methods`, [], (e, r) => res.json(r || [])));

// Update UPI ID for UPI QR payment method
app.put('/api/payment-methods/upi', (req, res) => {
    const { upi_id } = req.body;
    if (!upi_id) return res.status(400).json({ error: 'upi_id required' });
    db.run(`UPDATE payment_methods SET upi_id = ? WHERE name = 'UPI QR'`, [upi_id.trim()], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        broadcast({ type: 'MENU_UPDATE' });
        res.json({ success: true, upi_id: upi_id.trim() });
    });
});

// Toggle enable/disable a payment method
app.put('/api/payment-methods/:id/toggle', (req, res) => {
    const { enabled } = req.body;
    db.run(`UPDATE payment_methods SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        broadcast({ type: 'MENU_UPDATE' });
        res.json({ success: true });
    });
});
app.get('/api/customers', (req, res) => db.all(`SELECT * FROM customers`, [], (e, r) => res.json(r || [])));

app.post('/api/customers', (req, res) => {
    const { name, email, phone } = req.body;
    const id = "CUST-" + uuidv4().substring(0, 8);
    db.run(`INSERT INTO customers (id, name, email, phone) VALUES (?, ?, ?, ?)`, [id, name, email || '', phone || ''], (err) => {
        if (err) return res.status(400).json({ error: err.message });
        res.json({ success: true, customer_id: id });
    });
});

app.delete('/api/customers/:id', (req, res) => {
    db.run(`DELETE FROM customers WHERE id=?`, [req.params.id], () => res.json({ success: true }));
});

/* ==========================================
   KDS / KITCHEN DISPLAY PORTS
========================================== */
app.get('/api/kds/orders', (req, res) => {
    db.all(`SELECT * FROM orders WHERE kds_status IN ('To Cook','Preparing') ORDER BY created_at ASC`, [], (err, orders) => {
        if (!orders || !orders.length) return res.json([]);
        let pending = orders.length;
        orders.forEach(order => {
            db.all(`SELECT * FROM order_items WHERE order_id=?`, [order.id], (err2, items) => {
                order.items = items || [];
                if (--pending === 0) res.json(orders);
            });
        });
    });
});

app.post('/api/kds/update-stage', (req, res) => {
    const { order_id, next_stage } = req.body;
    db.run(`UPDATE orders SET kds_status=? WHERE id=?`, [next_stage, order_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        broadcast({ type: "KDS_UPDATE" });
        res.json({ success: true });
    });
});

app.post('/api/kds/toggle-item', (req, res) => {
    const { item_id, is_cooked } = req.body;
    db.run(`UPDATE order_items SET is_cooked=? WHERE id=?`, [is_cooked, item_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        broadcast({ type: "KDS_UPDATE" });
        res.json({ success: true });
    });
});

app.post('/api/receipt/email', (req, res) => {
    const { order_id, customer_email, pdf_base64, order_number, order_total } = req.body;
    if (!customer_email || !pdf_base64) return res.status(400).json({ error: 'Missing email or PDF data' });

    // ── NODEMAILER SETUP ─────────────────────────────────────────
    // Configure your SMTP credentials via environment variables:
    //   EMAIL_HOST      (e.g. smtp.gmail.com)
    //   EMAIL_PORT      (e.g. 587)
    //   EMAIL_USER      (your sender address)
    //   EMAIL_PASS      (app password / SMTP password)
    //   EMAIL_FROM_NAME (display name, default: Unity $hop)
    //
    // For Gmail: enable "App Passwords" in your Google account and
    // set EMAIL_PASS to the 16-char app password.
    // ─────────────────────────────────────────────────────────────
    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch (e) { return res.status(500).json({ error: 'nodemailer not installed. Run: npm install nodemailer' }); }

    if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('[Receipt Email] SMTP env vars not set — logging to console instead.');
        console.log(`[Receipt Email] Would send to: ${customer_email}, Order: ${order_number}, Total: ₹${order_total}`);
        return res.json({ success: true, note: 'SMTP not configured — email logged to console only.' });
    }

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_PORT === '465',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const pdfBuffer = Buffer.from(pdf_base64, 'base64');

    const mailOptions = {
        from: `"${process.env.EMAIL_FROM_NAME || 'Unity $hop'}" <${process.env.EMAIL_USER}>`,
        to: customer_email,
        subject: `Your Receipt — ${order_number} | Unity $hop`,
        html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0f0f1a;color:#e2e8f0;padding:32px;border-radius:16px;">
                <h2 style="color:#a78bfa;margin:0 0 4px">Unity $hop</h2>
                <p style="color:#6b7280;font-size:12px;margin:0 0 24px">Premium Barista Engine</p>
                <p style="font-size:14px;">Thank you for your visit! Your receipt is attached as a PDF.</p>
                <div style="background:#1e1b4b;border:1px solid #312e81;border-radius:12px;padding:16px;margin:20px 0;">
                    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;">
                        <span style="color:#94a3b8;">Order</span>
                        <span style="color:#a78bfa;font-weight:bold;font-family:monospace;">${order_number}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;">
                        <span style="color:#e2e8f0;">Total Paid</span>
                        <span style="color:#a78bfa;font-family:monospace;">₹${parseFloat(order_total || 0).toFixed(2)}</span>
                    </div>
                </div>
                <p style="font-size:12px;color:#6b7280;">Visit us again soon. ☕</p>
            </div>
        `,
        attachments: [{
            filename: `Receipt-${order_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
        }]
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error('[Receipt Email] Send error:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`[Receipt Email] Sent to ${customer_email} — MessageId: ${info.messageId}`);
        res.json({ success: true, message_id: info.messageId });
    });
});

// Root redirect to bypass wildcard routing
app.get(/^(?!\/api).*$/, (req, res) => { res.sendFile(path.join(__dirname, '../frontend/index.html')); });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on http://127.0.0.1:${PORT}`));