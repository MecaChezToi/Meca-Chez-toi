const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) console.error('Error opening database', err.message);
  else {
    console.log('Connected to the SQLite database.');
    createTables();
  }
});

function createTables() {
  // Appointments Table
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    address TEXT,
    vehicle TEXT,
    vin TEXT,
    service TEXT,
    date TEXT,
    slot TEXT,
    location TEXT,
    message TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Inventory Table
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    quantity INTEGER DEFAULT 0,
    unit TEXT,
    min_threshold INTEGER DEFAULT 5
  )`, () => {
    // Seed initial inventory if empty
    db.get("SELECT COUNT(*) as count FROM inventory", (err, row) => {
      if (row.count === 0) {
        const seed = [
          ['Huile moteur (L)', 50, 'L', 10],
          ['Filtre à huile', 15, 'pcs', 5],
          ['Bougies d\'allumage', 24, 'pcs', 8],
          ['Filtre à air', 10, 'pcs', 3],
          ['Plaquettes de frein (jeu)', 8, 'pcs', 2]
        ];
        const stmt = db.prepare("INSERT INTO inventory (name, quantity, unit, min_threshold) VALUES (?, ?, ?, ?)");
        seed.forEach(item => stmt.run(item));
        stmt.finalize();
      }
    });
  });

  // Service to Inventory mapping (Simplified)
  db.run(`CREATE TABLE IF NOT EXISTS service_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT,
    part_name TEXT,
    quantity_needed INTEGER
  )`, () => {
    db.get("SELECT COUNT(*) as count FROM service_requirements", (err, row) => {
      if (row.count === 0) {
        const requirements = [
          ['Vidange simple', 'Huile moteur (L)', 5],
          ['Vidange simple', 'Filtre à huile', 1],
          ['Petit entretien', 'Huile moteur (L)', 5],
          ['Petit entretien', 'Filtre à huile', 1],
          ['Petit entretien', 'Filtre à air', 1],
          ['Entretien premium', 'Huile moteur (L)', 5],
          ['Entretien premium', 'Filtre à huile', 1],
          ['Entretien premium', 'Filtre à air', 1],
          ['Entretien premium', 'Bougies d\'allumage', 4],
          ['Gros entretien diesel', 'Huile moteur (L)', 7],
          ['Gros entretien diesel', 'Filtre à huile', 1],
          ['Gros entretien diesel', 'Filtre à air', 1],
          ['Gros entretien essence', 'Huile moteur (L)', 5],
          ['Gros entretien essence', 'Filtre à huile', 1],
          ['Gros entretien essence', 'Filtre à air', 1],
          ['Plaquettes avant', 'Plaquettes de frein (jeu)', 1]
        ];
        const stmt = db.prepare("INSERT INTO service_requirements (service_name, part_name, quantity_needed) VALUES (?, ?, ?)");
        requirements.forEach(req => stmt.run(req));
        stmt.finalize();
      }
    });
  });
}

// API Routes

// 1. Appointments
app.post('/api/appointments', (req, res) => {
  const { firstName, lastName, phone, address, vehicle, vin, service, date, slot, location, message } = req.body;
  
  // Check if slot is already taken
  db.get("SELECT id FROM appointments WHERE date = ? AND slot = ? AND status != 'cancelled'", [date, slot], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      return res.status(400).json({ error: 'Ce créneau est déjà réservé.' });
    }

    const sql = `INSERT INTO appointments (first_name, last_name, phone, address, vehicle, vin, service, date, slot, location, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [firstName, lastName, phone, address, vehicle, vin, service, date, slot, location, message], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: 'Appointment created successfully' });
    });
  });
});

// Get taken slots for a date
app.get('/api/appointments/taken', (req, res) => {
  const { date } = req.query;
  db.all("SELECT slot FROM appointments WHERE date = ? AND status != 'cancelled'", [date], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.slot));
  });
});

app.get('/api/appointments', (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.patch('/api/appointments/:id', (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  // Intelligent Stock Deduction when confirmed/done
  if (status === 'confirmed' || status === 'done') {
    db.get("SELECT service FROM appointments WHERE id = ?", [id], (err, appointment) => {
      if (appointment) {
        db.all("SELECT part_name, quantity_needed FROM service_requirements WHERE service_name = ?", [appointment.service], (err, reqs) => {
          if (reqs) {
            reqs.forEach(req => {
              db.run("UPDATE inventory SET quantity = quantity - ? WHERE name = ?", [req.quantity_needed, req.part_name]);
            });
          }
        });
      }
    });
  }

  db.run("UPDATE appointments SET status = ? WHERE id = ?", [status, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Status updated' });
  });
});

// 2. Inventory
app.get('/api/inventory', (req, res) => {
  db.all("SELECT * FROM inventory", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.patch('/api/inventory/:id', (req, res) => {
  const { quantity } = req.body;
  db.run("UPDATE inventory SET quantity = ? WHERE id = ?", [quantity, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Inventory updated' });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
