const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, 'nodes_config.json');
const SECRET_KEY = 'moni-dashboard-secret-key-123'; // In production, move to env
const ALGORITHM = 'aes-256-cbc';
const APP_USER = { username: 'admin', password: 'password123' };

// Disable SSL verification for self-signed Proxmox certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Encryption Helpers
function encrypt(text) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, crypto.scryptSync(SECRET_KEY, 'salt', 32), iv);
    let encrypted = cipher.update(str);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) { return str; }
}

function decrypt(text) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  if (!str.includes(':')) return str;
  try {
    const textParts = str.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, crypto.scryptSync(SECRET_KEY, 'salt', 32), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) { return str; }
}

// ─── State ────────────────────────────────────────────────────────────────────
let nodes = [];           // array of { id, host, ticket, CSRFPreventionToken, nodeName, username, password }
let monitoredVMs = [];    // array of { nodeId, vmid }
let vmCache = {};         // "nodeId:vmid" -> latest status
let nodeCache = {};       // "nodeId" -> latest status
let trafficHistory = Array.from({ length: 60 }, () => Math.floor(Math.random() * 300) + 50);

// Persistence Helpers
function loadData() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      nodes = (data.nodes || []).map(n => ({
        ...n,
        id: decrypt(n.id),
        host: decrypt(n.host),
        username: decrypt(n.username),
        password: decrypt(n.password)
      }));
      monitoredVMs = (data.monitoredVMs || []).map(m => ({
        nodeId: decrypt(m.nodeId),
        vmid: parseInt(decrypt(m.vmid))
      }));
      console.log(`💾 Data loaded & decrypted: ${nodes.length} nodes, ${monitoredVMs.length} VMs.`);
    } catch (e) {
      console.error('Error loading config:', e.message);
    }
  }
}

function saveData() {
  // Save everything encrypted
  const savedNodes = nodes.map(({ id, host, nodeName, username, password }) => ({
    id: encrypt(id),
    nodeName,
    host: encrypt(host), 
    username: encrypt(username), 
    password: encrypt(password)
  }));
  const savedVMs = monitoredVMs.map(m => ({
    nodeId: encrypt(m.nodeId),
    vmid: encrypt(m.vmid.toString())
  }));
  const data = { nodes: savedNodes, monitoredVMs: savedVMs };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

try {
  loadData();
  saveData(); // Migrate to encrypted format
} catch (e) {
  console.error('Migration failed:', e.message);
}

// ─── Proxmox Helpers ─────────────────────────────────────────────────────────
function pveGet(node, path) {
  return axios.get(`https://${node.host}:8006/api2/json${path}`, {
    httpsAgent,
    headers: { Cookie: `PVEAuthCookie=${node.ticket}` }
  });
}

function pvePost(node, path, data = {}) {
  return axios.post(`https://${node.host}:8006/api2/json${path}`, data, {
    httpsAgent,
    headers: {
      Cookie: `PVEAuthCookie=${node.ticket}`,
      CSRFPreventionToken: node.CSRFPreventionToken
    }
  });
}

async function refreshTickets() {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    try {
      // Test if current ticket works
      await pveGet(node, '/nodes');
    } catch (e) {
      if (!node.ticket || e.response?.status === 401) {
        console.log(`🔄 Refreshing ticket for ${node.host}...`);
        try {
          const loginRes = await axios.post(
            `https://${node.host}:8006/api2/json/access/ticket`,
            { username: node.username, password: node.password },
            { httpsAgent, timeout: 5000 }
          );
          nodes[i].ticket = loginRes.data.data.ticket;
          nodes[i].CSRFPreventionToken = loginRes.data.data.CSRFPreventionToken;
          saveData();
          console.log(`✅ Ticket refreshed for ${node.host}`);
        } catch (err) {
          console.error(`❌ Failed to refresh ticket for ${node.host}:`, err.message);
        }
      }
    }
  }
}

// ─── REST Endpoints ───────────────────────────────────────────────────────────

// App-Level Login
app.post('/api/app-login', (req, res) => {
  const { username, password } = req.body;
  if (username === APP_USER.username && password === APP_USER.password) {
    res.json({ success: true, token: 'session-' + Date.now() });
  } else {
    res.status(401).json({ success: false, error: 'Username/Password aplikasi salah.' });
  }
});

// Connect to a new Proxmox Node
app.post('/api/connect', async (req, res) => {
  const { host, username, password } = req.body;
  console.log(`📡 Attempting to connect to: ${host} as ${username}...`);
  
  if (!host || !username || !password) {
    return res.status(400).json({ success: false, error: 'Data tidak lengkap.' });
  }

  // Check if already connected to this host
  if (nodes.find(n => n.host === host)) {
    console.log(`⚠️ Host ${host} already connected.`);
    return res.status(400).json({ success: false, error: 'Server ini sudah terhubung.' });
  }

  try {
    console.log(`🔑 Fetching ticket from https://${host}:8006/...`);
    const loginRes = await axios.post(
      `https://${host}:8006/api2/json/access/ticket`,
      { username, password },
      { httpsAgent, timeout: 5000 }
    );

    const { ticket, CSRFPreventionToken } = loginRes.data.data;
    console.log(`🎫 Ticket received. Fetching node info...`);

    const nodesRes = await axios.get(`https://${host}:8006/api2/json/nodes`, {
      httpsAgent,
      headers: { Cookie: `PVEAuthCookie=${ticket}` },
      timeout: 5000
    });

    if (!nodesRes.data.data || nodesRes.data.data.length === 0) {
      throw new Error('Tidak ada node ditemukan di server Proxmox ini.');
    }

    let nodeName = nodesRes.data.data[0].node; // Default to first
    
    // Attempt to find the specific node that matches this host IP
    console.log(`🔍 Searching for node matching ${host}...`);
    for (const n of nodesRes.data.data) {
      try {
        const netRes = await axios.get(`https://${host}:8006/api2/json/nodes/${n.node}/network`, {
          httpsAgent,
          headers: { Cookie: `PVEAuthCookie=${ticket}` },
          timeout: 2000
        });
        const hasIP = netRes.data.data.some(net => net.address === host || net.address6 === host || (net.cidr && net.cidr.startsWith(host)));
        if (hasIP) {
          nodeName = n.node;
          console.log(`🎯 Matched Node: ${nodeName}`);
          break;
        }
      } catch (e) { /* ignore network fetch errors for specific nodes */ }
    }

    const nodeId = Date.now().toString();
    const newNode = { id: nodeId, host, ticket, CSRFPreventionToken, nodeName, username, password };
    nodes.push(newNode);
    saveData();

    console.log(`✅ Success! Node Added: ${host} (${nodeName})`);
    io.emit('nodesUpdate', nodes.map(n => ({ id: n.id, host: n.host, nodeName: n.nodeName })));
    
    res.json({ success: true, node: newNode });
  } catch (err) {
    console.error('❌ Connection error:', err.message);
    let msg = 'Gagal konek ke Proxmox.';
    if (err.code === 'ECONNREFUSED') msg = 'Koneksi ditolak. Cek IP & Port 8006.';
    if (err.code === 'ETIMEDOUT') msg = 'Waktu koneksi habis (Timeout).';
    if (err.response?.status === 401) msg = 'Username atau Password salah (Realm @pam/@pve?)';
    
    res.status(401).json({ success: false, error: msg });
  }
});

// Remove a Node
app.post('/api/nodes/remove', (req, res) => {
  const { id } = req.body;
  nodes = nodes.filter(n => n.id !== id);
  monitoredVMs = monitoredVMs.filter(m => m.nodeId !== id);
  saveData();
  
  // Clean cache
  delete nodeCache[id];
  Object.keys(vmCache).forEach(key => {
    if (key.startsWith(`${id}:`)) delete vmCache[key];
  });

  io.emit('nodesUpdate', nodes.map(n => ({ id: n.id, host: n.host, nodeName: n.nodeName })));
  res.json({ success: true });
});

// Get all connected nodes
app.get('/api/nodes', (req, res) => {
  res.json({ success: true, nodes: nodes.map(n => ({ id: n.id, host: n.host, nodeName: n.nodeName })) });
});

// Get all VMs from ALL connected nodes
app.get('/api/vms', async (req, res) => {
  if (nodes.length === 0) return res.json({ success: true, vms: [] });
  
  try {
    const allVMs = [];
    for (const node of nodes) {
      try {
        const vmRes = await pveGet(node, `/nodes/${node.nodeName}/qemu`);
        const vms = vmRes.data.data.map(v => ({
          ...v,
          nodeId: node.id,
          nodeHost: node.host
        }));
        allVMs.push(...vms);
      } catch (e) {
        console.error(`Error fetching VMs from ${node.host}:`, e.message);
      }
    }
    res.json({ success: true, vms: allVMs.sort((a,b) => a.vmid - b.vmid) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set which VMs to monitor (global across all nodes)
app.post('/api/monitor', (req, res) => {
  monitoredVMs = req.body.vms || []; // Expecting [{nodeId, vmid}, ...]
  saveData();
  console.log('🔭 Monitoring Global VMs:', monitoredVMs.length);
  res.json({ success: true });
});

// Start / Stop a VM
app.post('/api/control', async (req, res) => {
  const { nodeId, vmid, action } = req.body;
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return res.status(404).json({ error: 'Node tidak ditemukan' });

  try {
    await pvePost(node, `/nodes/${node.nodeName}/qemu/${vmid}/status/${action}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Polling Loop ─────────────────────────────────────────────────────────────
async function pollVMs() {
  if (nodes.length === 0 || monitoredVMs.length === 0) return;
  await refreshTickets();

  const updates = await Promise.allSettled(
    monitoredVMs.map(async ({ nodeId, vmid }) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return null;
      try {
        const r = await pveGet(node, `/nodes/${node.nodeName}/qemu/${vmid}/status/current`);
        return { 
          key: `${nodeId}:${vmid}`, 
          data: { ...r.data.data, nodeId, nodeHost: node.host, vmid } 
        };
      } catch (e) { return null; }
    })
  );

  updates.forEach(u => {
    if (u.status === 'fulfilled' && u.value) {
      const data = u.value.data;
      
      // Calculate VM Health
      let health = 'healthy';
      const cpu = (data.cpu || 0) * 100;
      const mem = data.maxmem ? (data.mem / data.maxmem) * 100 : 0;
      
      if (cpu > 95 || mem > 98) health = 'critical';
      else if (cpu > 80 || mem > 90) health = 'warning';
      else if (data.status === 'stopped') health = 'inactive';

      vmCache[u.value.key] = { ...data, health };
    }
  });

  // Traffic simulation (Aggregate from all running VMs)
  const runningVMs = Object.values(vmCache).filter(v => v.status === 'running');
  const baseTraffic = runningVMs.length * 150;
  const newTraffic = Math.floor(baseTraffic + Math.random() * 400);
  trafficHistory.push(newTraffic);
  if (trafficHistory.length > 60) trafficHistory.shift();

  io.emit('vmUpdate', Object.values(vmCache));
  io.emit('trafficUpdate', { current: newTraffic, history: trafficHistory });
}

async function pollNodes() {
  if (nodes.length === 0) {
    io.emit('nodeHealthUpdate', []);
    return;
  }
  await refreshTickets();

  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      try {
        const res = await pveGet(node, `/nodes/${node.nodeName}/status`);
        const status = res.data.data;
        
        let health = 'healthy';
        const cpuPct = (status.cpu || 0) * 100;
        const memPct = status.memory ? (status.memory.used / status.memory.total) * 100 : 0;
        
        if (cpuPct > 90 || memPct > 95) health = 'critical';
        else if (cpuPct > 75 || memPct > 85) health = 'warning';

        nodeCache[node.id] = {
          nodeId: node.id,
          nodeName: node.nodeName,
          host: node.host,
          status: 'online',
          health,
          cpu: status.cpu,
          memory: status.memory,
          uptime: status.uptime
        };
      } catch (err) {
        nodeCache[node.id] = {
          nodeId: node.id,
          nodeName: node.nodeName,
          host: node.host,
          status: 'offline',
          health: 'critical'
        };
      }
    })
  );

  const currentHealth = nodes.map(n => nodeCache[n.id]).filter(Boolean);
  io.emit('nodeHealthUpdate', currentHealth);
}

setInterval(pollVMs, 3000);
setInterval(pollNodes, 5000);

// Idle simulation
setInterval(() => {
  if (nodes.length > 0) return;
  const newT = Math.floor(Math.random() * 100) + 20;
  trafficHistory.push(newT);
  if (trafficHistory.length > 60) trafficHistory.shift();
  io.emit('trafficUpdate', { current: newT, history: trafficHistory });
}, 3000);

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('🟢 Client connected:', socket.id);
  socket.emit('nodesUpdate', nodes.map(n => ({ id: n.id, host: n.host, nodeName: n.nodeName })));
  socket.emit('nodeHealthUpdate', Object.values(nodeCache));
  socket.emit('vmUpdate', Object.values(vmCache));
  socket.emit('trafficUpdate', {
    current: trafficHistory[trafficHistory.length - 1],
    history: trafficHistory
  });
});

const PORT = 3001;
server.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
