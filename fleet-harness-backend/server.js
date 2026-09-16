require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', require('./routes/triage'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Fleet Triage Harness backend listening on http://localhost:${PORT}`);
});
