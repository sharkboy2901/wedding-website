'use strict';

const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

// Serve everything in /public as static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback — always serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
});
