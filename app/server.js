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
        res.status(500).json({ status: 'unhealthy', database: err.message });
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
        <title>User Management System</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f4F6F9;
                color: #333;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .container {
                max-width: 600px;
                width: 100%;
                background: white;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.05);
            }
            h1 {
                margin-top: 0;
                color: #0078d4;
                text-align: center;
            }
            form {
                display: flex;
                flex-direction: column;
                gap: 15px;
                margin-bottom: 30px;
            }
            label {
                font-weight: 600;
            }
            input {
                padding: 10px;
                border: 1px solid #ccc;
                border-radius: 6px;
                font-size: 16px;
            }
            button {
                padding: 12px;
                background-color: #0078d4;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 16px;
                cursor: pointer;
                font-weight: 600;
                transition: background-color 0.2s;
            }
            button:hover {
                background-color: #005a9e;
            }
            .user-list {
                list-style: none;
                padding: 0;
            }
            .user-item {
                background: #f9f9f9;
                padding: 12px;
                margin-bottom: 10px;
                border-radius: 6px;
                border-left: 4px solid #0078d4;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .user-info {
                display: flex;
                flex-direction: column;
            }
            .user-name {
                font-weight: 600;
            }
            .user-email {
                font-size: 14px;
                color: #666;
            }
            .status {
                text-align: center;
                margin-top: 20px;
                font-size: 14px;
                color: #555;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>User Management Directory</h1>
            <form id="userForm">
                <div>
                    <label for="name">Name</label>
                    <input type="text" id="name" required style="width: 96%;">
                </div>
                <div>
                    <label for="email">Email</label>
                    <input type="email" id="email" required style="width: 96%;">
                </div>
                <button type="submit">Add User</button>
            </form>

            <h2>Existing Users</h2>
            <ul id="userList" class="user-list"></ul>
            <div id="status" class="status">Loading status...</div>
        </div>

        <script>
            const userForm = document.getElementById('userForm');
            const userList = document.getElementById('userList');
            const statusDiv = document.getElementById('status');

            async function fetchUsers() {
                try {
                    const response = await fetch('/api/users');
                    const users = await response.json();
                    if (response.ok) {
                        userList.innerHTML = users.map(user => \`
                            <li class="user-item">
                                <div class="user-info">
                                    <span class="user-name">\${escapeHtml(user.name)}</span>
                                    <span class="user-email">\${escapeHtml(user.email)}</span>
                                </div>
                                <span style="font-size:12px;color:#999;">\${new Date(user.created_at).toLocaleDateString()}</span>
                            </li>
                        \`).join('');
                    } else {
                        userList.innerHTML = '<li style="color:red;">Failed to load users: ' + (users.error || 'Unknown error') + '</li>';
                    }
                } catch (err) {
                    userList.innerHTML = '<li style="color:red;">Error fetching users.</li>';
                }
            }

            async function checkHealth() {
                try {
                    const response = await fetch('/health');
                    const data = await response.json();
                    if (response.ok && data.status === 'healthy') {
                        statusDiv.innerHTML = '<span style="color:green;">● Connected to Azure SQL Database</span>';
                    } else {
                        statusDiv.innerHTML = '<span style="color:red;">● Database offline: ' + (data.database || 'Unknown error') + '</span>';
                    }
                } catch (err) {
                    statusDiv.innerHTML = '<span style="color:red;">● Cannot connect to server health endpoint.</span>';
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
                        document.getElementById('name').value = '';
                        document.getElementById('email').value = '';
                        fetchUsers();
                        checkHealth();
                    } else {
                        alert(data.error || 'Failed to add user');
                    }
                } catch (err) {
                    alert('Error submitting form');
                }
            });

            function escapeHtml(str) {
                return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
            }

            fetchUsers();
            checkHealth();
        </script>
    </body>
    </html>
    `);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
