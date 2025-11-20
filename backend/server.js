require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const { exec } = require('child_process');


const app = express();
app.use(cors())
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

['uploads', 'offline_audios'].forEach(folder => {
  const folderPath = path.join(__dirname, folder);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
});

// MySQL Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// ...existing code...

// Input validation helper
function validateSignup(data) {
    const { name, dob, passport_number, issue_date, user_private_key, govt_signature, destination_place } = data;
    if (!name || typeof name !== 'string' || name.length < 2) return 'Invalid name';
    if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 'Invalid date of birth';
    if (!passport_number || typeof passport_number !== 'string') return 'Invalid passport number';
    if (!issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(issue_date)) return 'Invalid issue date';
    if (!user_private_key || typeof user_private_key !== 'string') return 'Invalid user private key';
    if (!govt_signature || typeof govt_signature !== 'string') return 'Invalid government signature';
    if (!destination_place || typeof destination_place !== 'string') return 'Invalid destination place';
    return null;
}

// Dummy authentication middleware
function authenticate(req, res, next) {
    // Example: check for a token in headers
    const token = req.headers['authorization'];
    if (!token || token !== process.env.AUTH_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// JWT authentication middleware (used for user JWTs)
function jwtAuthenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Missing token' });
    }
    jwt.verify(token, process.env.JWT_SECRET || 'mysecret', (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.auth = decoded; // attach decoded payload e.g., { user_data_hash }
        next();
    });
}

// Signup API (JSON only)
app.post('/api/signup', async (req, res) => {
    try {
        // Ensure req.body exists and has all required fields
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'No signup data received.' });
        }
    const { name, dob, passport_number, issue_date, user_private_key, govt_signature, destination_place } = req.body;

        if (!name || !dob || !passport_number || !issue_date || !user_private_key || !govt_signature || !destination_place) {
            return res.status(400).json({ error: 'Missing required signup fields.' });
        }
        const validationError = validateSignup(req.body);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }
    const dataString = `${name}|${dob}|${passport_number}|${issue_date}|${destination_place}`;
    const user_data_hash = crypto.createHash('sha256').update(dataString).digest('hex');
    // Hash user_private_key and govt_signature with bcrypt (salt rounds 15)
    const hashedUserKey = await bcrypt.hash(user_private_key, 15);
    const hashedGovtSignature = await bcrypt.hash(govt_signature, 15);
    // Check for existing user and handle activation/reactivation
    const [existing] = await db.query('SELECT * FROM users WHERE user_data_hash = ?', [user_data_hash]);
    if (existing.length > 0) {
        const user = existing[0];
        if (user.active === 1 || user.active === true) {
            return res.status(400).json({ error: 'User already exists and is active' });
        }
        // Reactivate existing inactive user
        await db.query('UPDATE users SET active = 1 WHERE user_data_hash = ?', [user_data_hash]);
        return res.json({ user_data_hash, reactivated: true });
    }
    // New user - proceed to insert
    await db.query(
        'INSERT INTO users (user_data_hash, name, dob, passport_number, issue_date, destination_place, user_signature, govt_signature, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user_data_hash, name, dob, passport_number, issue_date, destination_place, hashedUserKey, hashedGovtSignature, true]
    );

        return res.json({ user_data_hash, created: true });
    } catch (error) {
        // Log error internally, send generic message to client
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Login API (JSON only)
app.post('/api/login', async (req, res) => {
    try {
        const { name, dob, passport_number, issue_date, destination_place, user_private_key } = req.body;
        if (!name || !dob || !passport_number || !issue_date || !destination_place || !user_private_key) {
            return res.status(400).json({ error: 'Missing required login fields' });
        }

        const dataString = `${name}|${dob}|${passport_number}|${issue_date}|${destination_place}`;
        const user_data_hash = crypto.createHash('sha256').update(dataString).digest('hex');

        const [rows] = await db.query('SELECT * FROM users WHERE user_data_hash = ? AND active = 1', [user_data_hash]);
        console.log(rows);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid or inactive account' });
        }

        const user = rows[0];
        const keyMatch = await bcrypt.compare(user_private_key, user.user_signature);
        if (!keyMatch) {
            return res.status(401).json({ success: false, message: 'Invalid user ID or password' });
        }

        const token = jwt.sign({ user_data_hash }, process.env.JWT_SECRET || 'mysecret', { expiresIn: '1h' });
        return res.json({ success: true, user_data_hash, token });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Logout API - Clear JWT token (client-side logout)
app.post('/api/logout', (req, res) => {
    try {
        // For JWT tokens, we don't need server-side invalidation since they're stateless
        // The client will remove the token from storage
        return res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Sign Out API with authentication (for account deactivation)

app.post('/api/signout', jwtAuthenticate, async (req, res) => {
    try {
        const { user_data_hash, govt_signout_signature } = req.body;
        // Assume govt_signout_signature verified off-chain
        await db.query('UPDATE users SET active = 0 WHERE user_data_hash = ?', [user_data_hash]);
        return res.json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


// Token Verification API
app.get('/api/verify-token', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ valid: false });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'mysecret', (err, decoded) => {
        if (err) return res.status(401).json({ valid: false });
        return res.json({ valid: true, data: decoded });
    });
});

// server.js or routes.js (Express)
app.post('/api/get-destination', async (req, res) => {
  const { passport_number, user_private_key } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE passport_number = ? AND active = 1",
      [passport_number]
    );

    if (rows.length === 0) return res.status(404).json({ error: "User not found" });

    const row = rows[0];
    const keyMatch = await bcrypt.compare(user_private_key, row.user_signature);

    if (!keyMatch) return res.status(403).json({ error: "Invalid credentials" });

    return res.json({
      destination_place: row.destination_place,
      name: row.name,
      dob: row.dob,
      issue_date: row.issue_date
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Tourbuddy url
app.get('/api/tourbuddy-url', (req, res) => {
    const tourBuddy = 'https://chatgpt.com/g/g-691ef705dcfc81919b9a22464cf40c2f-tourbuddy';
    return res.status(200).json({ 'tourBuddy': tourBuddy });
});

// send-voice (SOS)
app.post('/api/send-voice', upload.single('audio'), async (req, res) => {
  const { mode } = req.body;
  const filePath = req.file.path;

  if (mode === 'online') {
    const formData = new FormData();
    formData.append('access_key', '65889113-4516-4dad-a20b-27478a951fc4');  // Get from https://web3forms.com
    formData.append('subject', 'Emergency SOS Voice Message');
    formData.append('from_name', 'TouristGaurd');
    formData.append('replyto', 'tourist_guard@example.com');
    formData.append('to', 'ncinimas@example.com');  // Your email where you want the message
    formData.append('files[sos_audio]', fs.createReadStream(filePath));

    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(result => {
      fs.unlinkSync(filePath);
      if (result.success) res.send('Voice message sent by Web3Forms successfully!');
      else res.status(500).send('Failed to send via Web3Forms: ' + JSON.stringify(result));
    })
    .catch(err => res.status(500).send('Error sending voice message: ' + err.message));

  } else {
    const offlinePath = path.join('offline_audios', req.file.originalname);
    fs.renameSync(filePath, offlinePath);

    exec(`linphonecsh generic "call sip:+911234567890@sipserver.local"`, (err1) => {
      if (err1) return res.status(500).send('Offline SIP call failed');

      exec(`linphonecsh generic "play ${offlinePath}"`, (err2) => {
        if (err2) return res.status(500).send('Failed to play offline voice message');
        res.send('Offline voice message played successfully!');
      });
    });
  }
});



app.listen(3000, () => {
    console.log('🚀 Backend running at http://localhost:3000');
});
