const express = require('express');
const sql = require('mssql');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
// Prioritize DB_CONNECTION_STRING, fallback to individual env vars
const connectionString = process.env.DB_CONNECTION_STRING;
let config;

if (connectionString) {
    console.log('Using DB_CONNECTION_STRING environment variable.');
    if (connectionString.startsWith('@Microsoft.KeyVault')) {
        console.warn('WARNING: Key Vault Reference is not resolved by Azure App Service. Raw value:', connectionString);
    }

    // Parse ADO.NET connection string (e.g., Server=tcp:...,1433;Database=...;User ID=...;Password=...)
    const params = {};
    connectionString.split(';').forEach(part => {
        const index = part.indexOf('=');
        if (index !== -1) {
            const key = part.substring(0, index).trim().toLowerCase();
            const val = part.substring(index + 1).trim();
            params[key] = val;
        }
    });

    const serverHost = params['server'] || params['data source'] || '';
    // Strip "tcp:" prefix and port number (e.g., ",1433")
    const cleanServer = serverHost.replace(/^tcp:/i, '').split(',')[0];

    config = {
        server: cleanServer || undefined,
        database: params['database'] || params['initial catalog'],
        user: params['user id'] || params['uid'],
        password: params['password'] || params['pwd'],
        port: 1433,
        options: {
            encrypt: true,
            trustServerCertificate: false
        }
    };

    console.log('Database configuration parsed successfully. Host:', config.server);
} else {
    console.log('DB_CONNECTION_STRING is not set. Falling back to individual env variables.');
    config = {
        server: process.env.DB_SERVER || 'localhost',
        database: process.env.DB_DATABASE || 'UserDB',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: 1433,
        options: {
            encrypt: true, // Use encryption for Azure SQL
            trustServerCertificate: false // Change to true for local dev if self-signed cert is used
        }
    };
}

let poolPromise;

function getPool() {
    if (!poolPromise) {
        poolPromise = sql.connect(config)
            .then(pool => {
                console.log('Connected to Azure SQL Database successfully.');
                // Initialize database schema (create users table if not exists)
                return pool.request().query(`
                    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='users' AND xtype='U')
                    CREATE TABLE users (
                        id INT IDENTITY(1,1) PRIMARY KEY,
                        name NVARCHAR(100) NOT NULL,
                        email NVARCHAR(100) NOT NULL UNIQUE,
                        created_at DATETIME DEFAULT GETDATE()
                    )
                `).then(() => pool);
            })
            .catch(err => {
                console.error('Database Connection Failed! Bad Config: ', err);
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

// Endpoint to get all users
app.get('/api/users', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Database query failed', details: err.message });
    }
});

// Endpoint to add a new user
app.post('/api/users', async (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
    }

    try {
        const pool = await getPool();
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .query('INSERT INTO users (name, email) VALUES (@name, @email)');
        res.status(201).json({ message: 'User added successfully' });
    } catch (err) {
        if (err.message.includes('UNIQUE KEY constraint')) {
            res.status(400).json({ error: 'Email already exists' });
        } else {
            res.status(500).json({ error: 'Database insertion failed', details: err.message });
        }
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request().query('SELECT 1');
        res.json({ status: 'healthy', database: 'connected' });
    } catch (err) {
        let debugInfo = `Error: ${err.message}. `;
        if (!process.env.DB_CONNECTION_STRING) {
            debugInfo += 'DB_CONNECTION_STRING is NOT set in environment variables.';
        } else if (process.env.DB_CONNECTION_STRING.startsWith('@Microsoft.KeyVault')) {
            debugInfo += 'DB_CONNECTION_STRING is set but contains an unresolved Key Vault Reference: ' + process.env.DB_CONNECTION_STRING;
        } else {
            debugInfo += 'DB_CONNECTION_STRING is set (length: ' + process.env.DB_CONNECTION_STRING.length + ').';
        }
        res.status(500).json({ status: 'unhealthy', database: debugInfo });
    }
});

// Endpoint to delete a user
app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM users WHERE id = @id');
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Database deletion failed', details: err.message });
    }
});

// Root HTML UI page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Identity Hub | User Directory</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg-main: #0b0f19;
                --bg-card: #151c2c;
                --bg-input: #1e293b;
                --text-main: #f8fafc;
                --text-muted: #94a3b8;
                --primary: #38bdf8;
                --primary-hover: #0ea5e9;
                --accent: #a855f7;
                --error: #f43f5e;
                --success: #10b981;
                --border: rgba(255, 255, 255, 0.08);
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: 'Inter', sans-serif;
                background-color: var(--bg-main);
                color: var(--text-main);
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                overflow-x: hidden;
            }

            body::before {
                content: '';
                position: absolute;
                width: 400px;
                height: 400px;
                background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(0,0,0,0) 70%);
                top: -100px;
                right: -50px;
                z-index: -1;
            }

            body::after {
                content: '';
                position: absolute;
                width: 500px;
                height: 500px;
                background: radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, rgba(0,0,0,0) 70%);
                bottom: -150px;
                left: -100px;
                z-index: -1;
            }

            header {
                border-bottom: 1px solid var(--border);
                backdrop-filter: blur(12px);
                background: rgba(11, 15, 25, 0.8);
                position: sticky;
                top: 0;
                z-index: 100;
                padding: 16px 40px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .logo-area {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .logo-icon {
                width: 32px;
                height: 32px;
                background: linear-gradient(135deg, var(--primary), var(--accent));
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: white;
            }

            .logo-text {
                font-size: 20px;
                font-weight: 700;
                letter-spacing: -0.5px;
                background: linear-gradient(to right, #ffffff, #94a3b8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .db-badge {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(30, 41, 59, 0.6);
                border: 1px solid var(--border);
                padding: 6px 14px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 500;
            }

            .badge-dot {
                width: 8px;
                height: 8px;
                background-color: var(--text-muted);
                border-radius: 50%;
            }

            .badge-dot.healthy {
                background-color: var(--success);
                box-shadow: 0 0 10px var(--success);
                animation: pulse 2s infinite;
            }

            .badge-dot.unhealthy {
                background-color: var(--error);
                box-shadow: 0 0 10px var(--error);
            }

            @keyframes pulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.3); opacity: 0.7; }
                100% { transform: scale(1); opacity: 1; }
            }

            main {
                max-width: 1280px;
                width: 100%;
                margin: 40px auto;
                padding: 0 24px;
                display: grid;
                grid-template-columns: 350px 1fr;
                gap: 32px;
            }

            @media (max-width: 900px) {
                main {
                    grid-template-columns: 1fr;
                }
            }

            .sidebar-pane {
                display: flex;
                flex-direction: column;
                gap: 24px;
            }

            .card {
                background: var(--bg-card);
                border: 1px solid var(--border);
                border-radius: 16px;
                padding: 24px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            }

            .card-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--text-muted);
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .stat-value {
                font-size: 48px;
                font-weight: 700;
                color: white;
                line-height: 1;
                background: linear-gradient(to right, #ffffff, var(--primary));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }

            .stat-desc {
                font-size: 13px;
                color: var(--text-muted);
                margin-top: 8px;
            }

            .form-group {
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 20px;
            }

            label {
                font-size: 14px;
                font-weight: 500;
                color: var(--text-muted);
            }

            input {
                background: var(--bg-input);
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 12px 16px;
                color: white;
                font-family: inherit;
                font-size: 15px;
                transition: border-color 0.2s, box-shadow 0.2s;
            }

            input:focus {
                outline: none;
                border-color: var(--primary);
                box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
            }

            button.btn-primary {
                width: 100%;
                padding: 14px;
                background: linear-gradient(135deg, var(--primary), var(--primary-hover));
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.15s, opacity 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            button.btn-primary:hover {
                opacity: 0.95;
            }

            button.btn-primary:active {
                transform: scale(0.98);
            }

            .directory-pane {
                display: flex;
                flex-direction: column;
                gap: 24px;
            }

            .dir-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 16px;
            }

            .search-box {
                max-width: 300px;
                width: 100%;
            }

            .btn-secondary {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--text-main);
                padding: 8px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.2s;
            }

            .btn-secondary:hover {
                background: rgba(255, 255, 255, 0.04);
            }

            .user-table-container {
                overflow-x: auto;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                text-align: left;
            }

            th, td {
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
            }

            th {
                font-size: 13px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--text-muted);
                background: rgba(255, 255, 255, 0.01);
            }

            tr {
                transition: background-color 0.2s;
            }

            tr:hover {
                background: rgba(255, 255, 255, 0.02);
            }

            .user-avatar-cell {
                display: flex;
                align-items: center;
                gap: 14px;
            }

            .avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, var(--primary), var(--accent));
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 14px;
                color: white;
            }

            .user-name-text {
                font-weight: 600;
                color: white;
            }

            .email-text {
                color: var(--text-muted);
            }

            .date-text {
                font-size: 14px;
                color: var(--text-muted);
            }

            .btn-delete {
                background: transparent;
                border: none;
                color: var(--error);
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                padding: 6px 12px;
                border-radius: 6px;
                transition: background-color 0.2s;
            }

            .btn-delete:hover {
                background: rgba(244, 63, 94, 0.1);
            }

            .toast-container {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .toast {
                background: #1e293b;
                border: 1px solid var(--border);
                border-left: 4px solid var(--primary);
                padding: 16px 20px;
                border-radius: 8px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                gap: 12px;
                min-width: 300px;
                animation: slideIn 0.3s forwards;
            }

            .toast.error {
                border-left-color: var(--error);
            }

            .toast.success {
                border-left-color: var(--success);
            }

            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }

            .error-card {
                background: rgba(244, 63, 94, 0.05);
                border: 1px solid rgba(244, 63, 94, 0.15);
                border-radius: 12px;
                padding: 16px;
                font-size: 14px;
                color: #fda4af;
                margin-top: 12px;
                display: none;
                word-break: break-all;
            }
        </style>
    </head>
    <body>
        <header>
            <div class="logo-area">
                <div class="logo-icon">I</div>
                <div class="logo-text">IdentityHub</div>
            </div>
            <div class="db-badge">
                <div id="badgeDot" class="badge-dot"></div>
                <span id="badgeText">Checking Connection...</span>
            </div>
        </header>

        <main>
            <div class="sidebar-pane">
                <div class="card">
                    <div class="card-title">Total Directory Users</div>
                    <div class="stat-value" id="userCount">0</div>
                    <div class="stat-desc">Synchronized with Azure SQL Database</div>
                </div>

                <div class="card">
                    <div class="card-title">Register New User</div>
                    <form id="userForm">
                        <div class="form-group">
                            <label for="name">Full Name</label>
                            <input type="text" id="name" placeholder="e.g. Ganesh K" required>
                        </div>
                        <div class="form-group">
                            <label for="email">Email Address</label>
                            <input type="email" id="email" placeholder="name@domain.com" required>
                        </div>
                        <button type="submit" class="btn-primary">Register User</button>
                    </form>
                    <div id="errorCard" class="error-card"></div>
                </div>
            </div>

            <div class="directory-pane card">
                <div class="dir-header">
                    <h2>Directory Registry</h2>
                    <div style="display: flex; gap: 12px; width: 100%; max-width: 450px; justify-content: flex-end;">
                        <input type="text" id="searchBox" class="search-box" placeholder="Search by name or email...">
                        <button id="btnExport" class="btn-secondary">Export CSV</button>
                    </div>
                </div>

                <div class="user-table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Registered At</th>
                                <th style="text-align: right;">Action</th>
                            </tr>
                        </thead>
                        <tbody id="userTableBody">
                            <tr>
                                <td colspan="4" style="text-align: center; color: var(--text-muted);">Loading user records...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </main>

        <div class="toast-container" id="toastContainer"></div>

        <script>
            let allUsers = [];
            const userForm = document.getElementById('userForm');
            const userTableBody = document.getElementById('userTableBody');
            const searchBox = document.getElementById('searchBox');
            const btnExport = document.getElementById('btnExport');
            const userCountText = document.getElementById('userCount');
            const badgeDot = document.getElementById('badgeDot');
            const badgeText = document.getElementById('badgeText');
            const toastContainer = document.getElementById('toastContainer');
            const errorCard = document.getElementById('errorCard');

            function showToast(message, type = 'success') {
                const toast = document.createElement('div');
                toast.className = \`toast \${type}\`;
                toast.innerHTML = \`
                    <span style="font-weight: 500;">\${message}</span>
                \`;
                toastContainer.appendChild(toast);
                setTimeout(() => {
                    toast.style.animation = 'slideIn 0.3s reverse';
                    setTimeout(() => toast.remove(), 300);
                }, 4000);
            }

            function getInitials(name) {
                return name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase() || 'U';
            }

            function renderTable(users) {
                if (users.length === 0) {
                    userTableBody.innerHTML = \`
                        <tr>
                            <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px 0;">
                                No records found.
                            </td>
                        </tr>
                    \`;
                    return;
                }

                userTableBody.innerHTML = users.map(user => {
                    const initials = getInitials(user.name);
                    const formattedDate = new Date(user.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });

                    return \`
                        <tr>
                            <td>
                                <div class="user-avatar-cell">
                                    <div class="avatar">\${initials}</div>
                                    <span class="user-name-text">\${escapeHtml(user.name)}</span>
                                </div>
                            </td>
                            <td><span class="email-text">\${escapeHtml(user.email)}</span></td>
                            <td><span class="date-text">\${formattedDate}</span></td>
                            <td style="text-align: right;">
                                <button class="btn-delete" onclick="deleteUser(\${user.id})">Delete</button>
                            </td>
                        </tr>
                    \`;
                }).join('');
            }

            async function fetchUsers() {
                try {
                    const response = await fetch('/api/users');
                    const users = await response.json();
                    if (response.ok) {
                        allUsers = users;
                        userCountText.innerText = allUsers.length;
                        filterAndRender();
                    } else {
                        showToast('Failed to load user directory.', 'error');
                    }
                } catch (err) {
                    showToast('Failed to fetch data from API.', 'error');
                }
            }

            async function checkHealth() {
                try {
                    const response = await fetch('/health');
                    const data = await response.json();
                    if (response.ok && data.status === 'healthy') {
                        badgeDot.className = 'badge-dot healthy';
                        badgeText.innerText = 'Azure SQL Connected';
                        errorCard.style.display = 'none';
                    } else {
                        badgeDot.className = 'badge-dot unhealthy';
                        badgeText.innerText = 'Database Disconnected';
                        errorCard.innerText = data.database || 'Database connection error';
                        errorCard.style.display = 'block';
                    }
                } catch (err) {
                    badgeDot.className = 'badge-dot unhealthy';
                    badgeText.innerText = 'Server Unreachable';
                }
            }

            function filterAndRender() {
                const query = searchBox.value.toLowerCase().trim();
                const filtered = allUsers.filter(user => 
                    user.name.toLowerCase().includes(query) || 
                    user.email.toLowerCase().includes(query)
                );
                renderTable(filtered);
            }

            async function deleteUser(id) {
                if(!confirm('Are you sure you want to delete this user?')) return;
                try {
                    const response = await fetch(\`/api/users/\${id}\`, { method: 'DELETE' });
                    const result = await response.json();
                    if (response.ok) {
                        showToast('User removed successfully.');
                        fetchUsers();
                    } else {
                        showToast(result.error || 'Failed to remove user.', 'error');
                    }
                } catch (err) {
                    showToast('Error sending delete request.', 'error');
                }
            }

            userForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = document.getElementById('name').value;
                const email = document.getElementById('email').value;

                try {
                    const response = await fetch('/api/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showToast('User registered successfully!');
                        document.getElementById('name').value = '';
                        document.getElementById('email').value = '';
                        fetchUsers();
                        checkHealth();
                    } else {
                        showToast(data.error || 'Failed to register user.', 'error');
                    }
                } catch (err) {
                    showToast('Network error submitting form.', 'error');
                }
            });

            searchBox.addEventListener('input', filterAndRender);

            btnExport.addEventListener('click', () => {
                if (allUsers.length === 0) {
                    showToast('No user data to export.', 'error');
                    return;
                }
                let csvContent = "data:text/csv;charset=utf-8,ID,Name,Email,RegisteredDate\\n";
                allUsers.forEach(user => {
                    csvContent += \`"\${user.id}","\${user.name.replace(/"/g, '""')}","\${user.email.replace(/"/g, '""')}","\${user.created_at}"\\n\`;
                });
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", "directory_export.csv");
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                showToast('CSV export downloaded!');
            });

            function escapeHtml(str) {
                return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            }

            fetchUsers();
            checkHealth();
            setInterval(checkHealth, 30000);
        </script>
    </body>
    </html>
    `);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
