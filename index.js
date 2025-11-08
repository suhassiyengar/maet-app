// index.js — Vercel-ready Node/Express proxy
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// --- DEBUGGING LINES ---
console.log("DEBUG: My MONGODB_URI variable is:", process.env.MONGODB_URI);
console.log("DEBUG: My DB_NAME variable is:", process.env.DB_NAME);
console.log("DEBUG: My COLLECTION variable is:", process.env.COLLECTION);
// --- END DEBUGGING ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "meddb";
const COLLECTION = process.env.COLLECTION || "medicines";

if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in .env");
  process.exit(1); // This will cause a server crash if URI is missing
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- NEW VERCL-READY CONNECTION LOGIC ---
// We cache the connection so it's not re-opened on every "warm" request
let client;
let db;
let col;

async function connectToDb() {
  // If we're already connected (warm start), return the existing collection
  if (db && col) {
    return col;
  }
  
  try {
    // If not connected (cold start), create a new connection
    client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db(DB_NAME);
    col = db.collection(COLLECTION);
    console.log("NEW Connection to MongoDB:", DB_NAME, COLLECTION);
    return col;
  } catch (err) {
    console.error("Mongo connection error:", err);
    // Don't exit process, just throw the error to be caught by the handler
    throw new Error("Failed to connect to database"); 
  }
}

// --- REMOVED OLD 'connect()' FUNCTION AND CALL ---

/*
Endpoints:
- GET /api/search?q=&page=&size=
- GET /api/medicines/:id
- GET /api/medicines/:id/alternatives?page=&size=
*/

// ✅ SEARCH ENDPOINT — now awaits connection
app.get("/api/search", async (req, res) => {
  try {
    // This line ensures 'col' is defined before we use it
    const collection = await connectToDb(); 

    const q = (req.query.q || "").trim();
    const page = Math.max(0, parseInt(req.query.page || "0"));
    const size = Math.min(200, Math.max(1, parseInt(req.query.size || "20")));
    if (!q) return res.json({ total: 0, documents: [] });

    const pageable = { skip: page * size, limit: size };
    const regex = new RegExp("^" + q, "i");

    // Use the 'collection' variable we awaited
    const docs = await collection
      .find(
        { brand_name: { $regex: regex } },
        {
          projection: {
            brand_name: 1,
            composition: 1,
            composition_key: 1,
            manufacturer: 1,
            dosage_form: 1,
            price: 1,
          },
        }
      )
      .skip(pageable.skip)
      .limit(pageable.limit)
      .toArray();

    res.json({ total: docs.length, documents: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ✅ FETCH MEDICINE BY ID — now awaits connection
app.get("/api/medicines/:id", async (req, res) => {
  try {
    // Await the connection
    const collection = await connectToDb();

    const id = req.params.id;
    const doc = await collection.findOne({
      _id: ObjectId.isValid(id) ? new ObjectId(id) : id,
    });
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ document: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ✅ GET ALTERNATIVES — now awaits connection
app.get("/api/medicines/:id/alternatives", async (req, res) => {
  try {
    // Await the connection
    const collection = await connectToDb();

    const id = req.params.id;
    const page = Math.max(0, parseInt(req.query.page || "0"));
    const size = Math.min(500, Math.max(1, parseInt(req.query.size || "100")));

    const base = await collection.findOne(
      { _id: ObjectId.isValid(id) ? new ObjectId(id) : id },
      { projection: { composition_key: 1 } }
    );
    if (!base || !base.composition_key)
      return res.json({ total: 0, documents: [] });

    const filter = { composition_key: base.composition_key, _id: { $ne: base._id } };
    const cursor = collection
      .find(filter, {
        projection: {
          brand_name: 1,
          composition: 1,
          composition_key: 1,
          manufacturer: 1,
          dosage_form: 1,
          price: 1,
        },
      })
      .skip(page * size)
      .limit(size);

    const docs = await cursor.toArray();
    res.json({ total: docs.length, documents: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

export default app;
