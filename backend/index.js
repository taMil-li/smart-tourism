require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
const { exec } = require("child_process");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json());

// -------------------- FILE / UPLOAD SETUP --------------------
const upload = multer({ dest: "uploads/" });

["uploads", "offline_audios"].forEach((folder) => {
  const folderPath = path.join(__dirname, folder);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
});

// -------------------- MONGODB SETUP --------------------
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const mongoDbName = process.env.MONGODB_DB || process.env.DB_NAME || "tourism";

let mongoClient;
let usersCollection;

async function initMongo() {
  if (usersCollection) return usersCollection;

  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db(mongoDbName);
  usersCollection = db.collection("users");

  // Indexes (optional but recommended)
  await usersCollection.createIndex({ user_data_hash: 1 }, { unique: true });
  await usersCollection.createIndex({ passport_number: 1 });

  console.log("✅ Connected to MongoDB and users collection initialized");
  return usersCollection;
}

// -------------------- HELPERS --------------------
function validateSignup(data) {
  const {
    name,
    dob,
    passport_number,
    issue_date,
    user_private_key,
    govt_signature,
    destination_place,
  } = data;

  if (!name || typeof name !== "string" || name.length < 2)
    return "Invalid name";
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "Invalid date of birth";
  if (!passport_number || typeof passport_number !== "string")
    return "Invalid passport number";
  if (!issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(issue_date))
    return "Invalid issue date";
  if (!user_private_key || typeof user_private_key !== "string")
    return "Invalid user private key";
  if (!govt_signature || typeof govt_signature !== "string")
    return "Invalid government signature";
  if (!destination_place || typeof destination_place !== "string")
    return "Invalid destination place";
  return null;
}

// Dummy authentication middleware (admin/system auth)
function authenticate(req, res, next) {
  const token = req.headers["authorization"];
  if (!token || token !== process.env.AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// JWT authentication middleware (user auth)
function jwtAuthenticate(req, res, next) {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }
  jwt.verify(token, process.env.JWT_SECRET || "mysecret", (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.auth = decoded; // e.g. { user_data_hash }
    next();
  });
}

// -------------------- ROUTES --------------------

// SIGNUP
app.post("/api/signup", async (req, res) => {
  try {
    const users = await initMongo();

    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "No signup data received." });
    }

    const {
      name,
      dob,
      passport_number,
      issue_date,
      user_private_key,
      govt_signature,
      destination_place,
    } = req.body;

    if (
      !name ||
      !dob ||
      !passport_number ||
      !issue_date ||
      !user_private_key ||
      !govt_signature ||
      !destination_place
    ) {
      return res.status(400).json({ error: "Missing required signup fields." });
    }

    const validationError = validateSignup(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const dataString = `${name}|${dob}|${passport_number}|${issue_date}|${destination_place}`;
    const user_data_hash = crypto
      .createHash("sha256")
      .update(dataString)
      .digest("hex");

    const hashedUserKey = await bcrypt.hash(user_private_key, 15);
    const hashedGovtSignature = await bcrypt.hash(govt_signature, 15);

    // Check if user already exists
    const existing = await users.findOne({ user_data_hash });

    if (existing) {
      if (existing.active === true || existing.active === 1) {
        return res
          .status(400)
          .json({ error: "User already exists and is active" });
      }
      // Reactivate existing inactive user
      await users.updateOne(
        { user_data_hash },
        {
          $set: {
            active: true,
            user_signature: hashedUserKey,
            govt_signature: hashedGovtSignature,
          },
        }
      );
      return res.json({ user_data_hash, reactivated: true });
    }

    // New user
    await users.insertOne({
      user_data_hash,
      name,
      dob,
      passport_number,
      issue_date,
      destination_place,
      user_signature: hashedUserKey,
      govt_signature: hashedGovtSignature,
      active: true,
      created_at: new Date(),
    });

    return res.json({ user_data_hash, created: true });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const users = await initMongo();

    const {
      name,
      dob,
      passport_number,
      issue_date,
      destination_place,
      user_private_key,
    } = req.body;

    if (
      !name ||
      !dob ||
      !passport_number ||
      !issue_date ||
      !destination_place ||
      !user_private_key
    ) {
      return res.status(400).json({ error: "Missing required login fields" });
    }

    const dataString = `${name}|${dob}|${passport_number}|${issue_date}|${destination_place}`;
    const user_data_hash = crypto
      .createHash("sha256")
      .update(dataString)
      .digest("hex");

    const user = await users.findOne({ user_data_hash, active: true });
    console.log("Login user lookup:", user);

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid or inactive account" });
    }

    const keyMatch = await bcrypt.compare(
      user_private_key,
      user.user_signature
    );
    if (!keyMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid user ID or password" });
    }

    const token = jwt.sign(
      { user_data_hash },
      process.env.JWT_SECRET || "mysecret",
      { expiresIn: "1h" }
    );

    return res.json({ success: true, user_data_hash, token });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// LOGOUT (client-side)
app.post("/api/logout", (req, res) => {
  try {
    // JWT is stateless; client just discards token
    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// SIGNOUT (deactivate account)
app.post("/api/signout", jwtAuthenticate, async (req, res) => {
  try {
    const users = await initMongo();

    const { user_data_hash, govt_signout_signature } = req.body;
    // govt_signout_signature assumed verified off-chain

    await users.updateOne(
      { user_data_hash },
      { $set: { active: false, deactivated_at: new Date() } }
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Signout error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// TOKEN VERIFICATION
app.get("/api/verify-token", (req, res) => {
  const token = req.headers["authorization"];
  if (!token) {
    return res.status(401).json({ valid: false });
  }

  jwt.verify(token, process.env.JWT_SECRET || "mysecret", (err, decoded) => {
    if (err) return res.status(401).json({ valid: false });
    return res.json({ valid: true, data: decoded });
  });
});

// GET DESTINATION BY PASSPORT + PRIVATE KEY
app.post("/api/get-destination", async (req, res) => {
  const { passport_number, user_private_key } = req.body;

  try {
    const users = await initMongo();

    const user = await users.findOne({ passport_number, active: true });
    if (!user) return res.status(404).json({ error: "User not found" });

    const keyMatch = await bcrypt.compare(
      user_private_key,
      user.user_signature
    );
    if (!keyMatch)
      return res.status(403).json({ error: "Invalid credentials" });

    return res.json({
      destination_place: user.destination_place,
      name: user.name,
      dob: user.dob,
      issue_date: user.issue_date,
    });
  } catch (err) {
    console.error("get-destination error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// TOURBUDDY URL
app.get("/api/tourbuddy-url", (req, res) => {
  const tourBuddy =
    "https://chatgpt.com/g/g-691ef705dcfc81919b9a22464cf40c2f-tourbuddy";
  return res.status(200).json({ tourBuddy });
});

// SEND VOICE (SOS)
app.post("/api/send-voice", upload.single("audio"), async (req, res) => {
  const { mode } = req.body;
  const filePath = req.file.path;

  if (mode === "online") {
    // NOTE: in Node 18+, FormData is global; otherwise you'd need 'form-data' package.
    const formData = new FormData();
    formData.append("access_key", "65889113-4516-4dad-a20b-27478a951fc4");
    formData.append("subject", "Emergency SOS Voice Message");
    formData.append("from_name", "TouristGaurd");
    formData.append("replyto", "tourist_guard@example.com");
    formData.append("to", "ncinimas@example.com");
    formData.append("files[sos_audio]", fs.createReadStream(filePath));

    fetch("https://api.web3forms.com/submit", {
      method: "POST",
      body: formData,
    })
      .then((response) => response.json())
      .then((result) => {
        fs.unlinkSync(filePath);
        if (result.success)
          res.send("Voice message sent by Web3Forms successfully!");
        else
          res
            .status(500)
            .send("Failed to send via Web3Forms: " + JSON.stringify(result));
      })
      .catch((err) => {
        console.error("send-voice online error:", err);
        res.status(500).send("Error sending voice message: " + err.message);
      });
  } else {
    const offlinePath = path.join("offline_audios", req.file.originalname);
    fs.renameSync(filePath, offlinePath);

    exec(
      `linphonecsh generic "call sip:+911234567890@sipserver.local"`,
      (err1) => {
        if (err1) return res.status(500).send("Offline SIP call failed");

        exec(`linphonecsh generic "play ${offlinePath}"`, (err2) => {
          if (err2)
            return res.status(500).send("Failed to play offline voice message");
          res.send("Offline voice message played successfully!");
        });
      }
    );
  }
});

// -------------------- START SERVER AFTER DB --------------------
initMongo()
  .then(() => {
    app.listen(3000, () => {
      console.log("🚀 Backend running at http://localhost:3000 (MongoDB)");
    });
  })
  .catch((err) => {
    console.error("Failed to initialize MongoDB:", err);
    process.exit(1);
  });
