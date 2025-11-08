// index.js — Node/Express proxy that queries MongoDB directly
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "meddb";
const COLLECTION = process.env.COLLECTION || "medicines";
// PORT is no longer needed here, Vercel handles it.
// const PORT = process.env.PORT || 3000; 

if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in .env");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

let col;
async function connect() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db(DB_NAME);
  col = db.collection(COLLECTION);
  console.log("Connected to MongoDB:", DB_NAME, COLLECTION);
}
connect().catch(err => {
  console.error("Mongo connection error:", err);
  process.exit(1);
});

/*
Endpoints:
- GET /api/search?q=&page=&size=
- GET /api/medicines/:id
- GET /api/medicines/:id/alternatives?page=&size=
*/

// ✅ SEARCH ENDPOINT — only matches brand_name starting with search text
app.get("/api/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const page = Math.max(0, parseInt(req.query.page || "0"));
    const size = Math.min(200, Math.max(1, parseInt(req.query.size || "20")));
    if (!q) return res.json({ total: 0, documents: [] });

    const pageable = { skip: page * size, limit: size };

    // 🔹 Regex that matches names starting with the given text (case-insensitive)
    const regex = new RegExp("^" + q, "i");

    const docs = await col
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

// ✅ FETCH MEDICINE BY ID
app.get("/api/medicines/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await col.findOne({
      _id: ObjectId.isValid(id) ? new ObjectId(id) : id,
    });
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ document: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// ✅ GET ALTERNATIVES BASED ON composition_key
app.get("/api/medicines/:id/alternatives", async (req, res) => {
  try {
    const id = req.params.id;
    const page = Math.max(0, parseInt(req.query.page || "0"));
    const size = Math.min(500, Math.max(1, parseInt(req.query.size || "100")));

    const base = await col.findOne(
      { _id: ObjectId.isValid(id) ? new ObjectId(id) : id },
      { projection: { composition_key: 1 } }
    );
    if (!base || !base.composition_key)
      return res.json({ total: 0, documents: [] });

    const filter = { composition_key: base.composition_key, _id: { $ne: base._id } };
    const cursor = col
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

// 
// --- REMOVED THIS BLOCK ---
//
// app.listen(PORT, () => {
//   console.log(`Proxy server running on http://localhost:${PORT}`);
// });
//
// --- ADDED THIS LINE ---
//
export default app;