import { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import TrafficChart from './TrafficChart';

const API = 'http://localhost:3001';
const socket = io(API);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatUptime(seconds) {
  if (!seconds) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function getBarColor(val) {
  if (val >= 80) return 'red';
  if (val >= 60) return 'yellow';
  return 'green';
}

function getValueClass(val) {
  if (val >= 80) return 'high';
  if (val >= 60) return 'mid';
  return 'low';
}

function getHealthIcon(health) {
  switch (health) {
    case 'critical': return '❌';
    case 'warning': return '⚠️';
    case 'healthy': return '✅';
    default: return '⚪';
  }
}

function AppLoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/api/app-login`, form);
      if (res.data.success) {
        localStorage.setItem('moni_token', res.data.token);
        onLogin();
      }
    } catch (err) {
      setError('Kredensial aplikasi salah.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="connect-page">
      <header className="connect-header">
        <div className="connect-logo">⬡</div>
        <h1 className="connect-title">Moni Dashboard</h1>
        <p className="connect-sub">Silakan login untuk mengakses panel kontrol infrastruktur</p>
      </header>
      <div className="connect-card fade-in">
        <h2><span>🔐</span> Login Aplikasi</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              placeholder="admin"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : '🔓 Masuk ke Dashboard'}
          </button>
          <p className="form-hint" style={{ textAlign: 'center', marginTop: '16px' }}>
            Default: <strong>admin</strong> / <strong>password123</strong>
          </p>
        </form>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('loading'); // loading | app-login | connect | select | dashboard
  const [isAppAuth, setIsAppAuth] = useState(false);
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    // Initial fetch to break loading state
    const fetchNodes = async () => {
      const token = localStorage.getItem('moni_token');
      if (!token) {
        setView('app-login');
        return;
      }
      setIsAppAuth(true);

      try {
        const res = await axios.get(`${API}/api/nodes`);
        if (res.data.success) {
          setNodes(res.data.nodes);
          if (res.data.nodes.length > 0) {
            setView('dashboard');
          } else {
            setView('connect');
          }
        }
      } catch (e) {
        setView('connect');
      }
    };

    fetchNodes();

    socket.on('nodesUpdate', (updatedNodes) => {
      setNodes(updatedNodes);
      setView(updatedNodes.length > 0 ? 'dashboard' : 'connect');
    });
    

    return () => {
      socket.off('nodesUpdate');
    };
  }, []);

  const handleAppLoggedIn = () => {
    setIsAppAuth(true);
    if (nodes.length > 0) setView('dashboard');
    else setView('connect');
  };

  const handleConnected = () => {
    setView('dashboard');
  };

  const handleLogoutApp = () => {
    localStorage.removeItem('moni_token');
    setIsAppAuth(false);
    setView('app-login');
  };

  if (view === 'loading') return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="spinner" style={{ width: '40px', height: '40px' }} />
    </div>
  );

  if (!isAppAuth || view === 'app-login') return <AppLoginPage onLogin={handleAppLoggedIn} />;

  if (view === 'connect') return <ConnectPage onConnected={handleConnected} />;
  
  if (view === 'select') return (
    <VMSelectorPage
      nodes={nodes}
      onStart={() => setView('dashboard')}
      onDisconnect={handleLogoutApp}
    />
  );

  return (
    <Dashboard
      nodes={nodes}
      onChangeVMs={() => setView('select')}
      onDisconnect={handleLogoutApp}
    />
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function ConnectPage({ onConnected, isAddingMore }) {
  const [form, setForm] = useState({ host: '', username: 'root@pam', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.host || !form.username || !form.password) {
      setError('Semua field wajib diisi.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`${API}/api/connect`, form);
      if (res.data.success) {
        onConnected(res.data.node);
      }
    } catch (err) {
      console.error(err);
      const rawError = err.response?.data?.error || err.message;
      setError(`Gagal: ${rawError}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={isAddingMore ? "" : "connect-page"}>
      {!isAddingMore && (
        <header className="connect-header">
          <div className="connect-logo">⬡</div>
          <h1 className="connect-title">VM Monitoring Dashboard</h1>
          <p className="connect-sub">Hubungkan ke Proxmox VE untuk mulai monitoring infrastruktur Anda</p>
        </header>
      )}

      <div className="connect-card fade-in" style={isAddingMore ? { maxWidth: '100%', background: 'var(--bg2)', padding: '24px' } : {}}>
        <h2><span>🔌</span> {isAddingMore ? "Tambah Node Proxmox" : "Koneksi Proxmox"}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Proxmox IP / Hostname</label>
            <div className="input-wrapper">
              <span className="input-icon">🌐</span>
              <input
                type="text"
                placeholder="192.168.1.100"
                value={form.host}
                onChange={e => setForm({ ...form, host: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Username</label>
              <div className="input-wrapper">
                <span className="input-icon">👤</span>
                <input
                  type="text"
                  placeholder="root@pam"
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>Password</label>
              <div className="input-wrapper">
                <span className="input-icon">🔑</span>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>
          </div>

          {error && <div className="alert alert-error">⚠️ {error}</div>}

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ height: '48px', borderRadius: '12px' }}>
            {loading ? <span className="spinner" /> : isAddingMore ? '➕ Tambah Node' : '🚀 Hubungkan ke Proxmox'}
          </button>
        </form>
      </div>
    </div>
  );
}

function VMSelectorPage({ nodes, onStart, onDisconnect }) {
  const [allVMs, setAllVMs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/api/vms`);
        if (res.data.success) {
          setAllVMs(res.data.vms);
          const running = res.data.vms.filter(v => v.status === 'running').map(v => ({ nodeId: v.nodeId, vmid: v.vmid }));
          setSelected(running);
        }
      } catch (err) {
        setError('Gagal mengambil daftar VM.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (v) => {
    const isSel = selected.some(s => s.nodeId === v.nodeId && s.vmid === v.vmid);
    setSelected(prev => isSel 
      ? prev.filter(p => !(p.nodeId === v.nodeId && p.vmid === v.vmid))
      : [...prev, { nodeId: v.nodeId, vmid: v.vmid }]
    );
  };

  const handleStart = async () => {
    if (selected.length === 0) return;
    await axios.post(`${API}/api/monitor`, { vms: selected });
    onStart();
  };

  return (
    <div className="select-page">
      <div className="select-page-inner fade-in">
        <header className="page-header">
          <div>
            <h1>🖥 Pilih VM Monitoring</h1>
            <div className="sub">Pilih VM dari {nodes.length} server yang terhubung</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onDisconnect}>✕ Putuskan Semua</button>
        </header>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '100px 0' }}><div className="spinner" /></div>
        ) : (
          <>
            <div className="vm-grid">
              {allVMs.map(vm => {
                const isSelected = selected.some(s => s.nodeId === vm.nodeId && s.vmid === vm.vmid);
                return (
                  <div key={`${vm.nodeId}:${vm.vmid}`} className={`vm-select-card ${isSelected ? 'selected' : ''}`} onClick={() => toggle(vm)}>
                    <div className="checkbox">✓</div>
                    <div className="vm-select-info">
                      <div className="vm-select-name">
                        {vm.name || `VM-${vm.vmid}`} <span className="vmid-badge">#{vm.vmid}</span>
                        <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: 'auto' }}>🌐 {vm.nodeHost}</span>
                      </div>
                      <div className="vm-select-meta">
                        <span>💾 {formatBytes(vm.maxmem)}</span> <span>🖥 {vm.cpus} vCPU</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-primary" disabled={selected.length === 0} onClick={handleStart} style={{ height: '56px', borderRadius: '16px' }}>
              🚀 Mulai Monitor ({selected.length} Instance)
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function VMCard({ vm, onControl, host }) {
  const [controlling, setControlling] = useState(false);
  const isStopped  = vm.status === 'stopped';
  const isStarting = vm.status === 'starting' || controlling;

  const cpuPct  = Math.round((vm.cpu || 0) * 100);
  const ramPct  = vm.maxmem ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
  const diskPct = vm.maxdisk ? Math.round((vm.disk / vm.maxdisk) * 100) : 0;

  const handleControl = async (action) => {
    setControlling(true);
    await onControl(vm.vmid, action);
    setTimeout(() => setControlling(false), 4000);
  };

  const openConsole = () => {
    const consoleUrl = `https://${host}:8006/#v1:0:=qemu/${vm.vmid}`;
    window.open(consoleUrl, '_blank');
  };

  return (
    <div className={`vm-card ${vm.status}`}>
      <div className="vm-header-row">
        <div className="vm-name-block">
          <div className="vm-name">
            {vm.name || `VM-${vm.vmid}`} <span className="vmid-badge">#{vm.vmid}</span>
            <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '8px' }}>🌐 {host}</span>
          </div>
          <div className="vm-meta-row">
            <span>🖥 {vm.cpus} vCPU</span> <span>💾 {formatBytes(vm.maxmem)}</span>
          </div>
        </div>
        <div className={`status-badge status-${vm.status}`}>{isStarting ? '⟳ processing...' : vm.status}</div>
      </div>

      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        <div className={`health-badge health-${vm.health}`}>
          {getHealthIcon(vm.health)} {vm.health}
        </div>
        {vm.health === 'critical' && <div className="health-badge health-critical">⚠️ ISSUE DETECTED</div>}
      </div>

      {!isStopped ? (
        <div className="resource-grid">
          <div className="resource-item">
            <div className="resource-header"><span>CPU</span> <span>{cpuPct}%</span></div>
            <div className="bar-track"><div className={`bar-fill ${getBarColor(cpuPct)}`} style={{ width: `${cpuPct}%` }} /></div>
          </div>
          <div className="resource-item">
            <div className="resource-header"><span>RAM</span> <span>{ramPct}%</span></div>
            <div className="bar-track"><div className="bar-fill blue" style={{ width: `${ramPct}%` }} /></div>
          </div>
        </div>
      ) : <div className="stopped-msg">VM Offline</div>}

      <div className="vm-footer">
        {isStopped ? 
          <button className="btn btn-start" disabled={isStarting} onClick={() => handleControl('start')}>▶ Start</button> :
          <button className="btn btn-stop" disabled={isStarting} onClick={() => handleControl('stop')}>⏹ Stop</button>
        }
        <button className="btn btn-ghost btn-sm" onClick={openConsole}>Console 🖥</button>
      </div>
    </div>
  );
}

function Dashboard({ nodes, onChangeVMs, onDisconnect }) {
  const [subView, setSubView] = useState('main');
  const [selectedNodeId, setSelectedNodeId] = useState(null); // New filter state
  const [vms, setVms] = useState([]);
  const [nodeHealth, setNodeHealth] = useState([]);
  const [traffic, setTraffic] = useState({ current: 0, history: [] });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    socket.on('vmUpdate', setVms);
    socket.on('nodeHealthUpdate', setNodeHealth);
    socket.on('trafficUpdate', setTraffic);
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => {
      socket.off('vmUpdate');
      socket.off('nodeHealthUpdate');
      socket.off('trafficUpdate');
      clearInterval(t);
    };
  }, []);

  const handleControl = async (vmid, action, nodeId) => {
    await axios.post(`${API}/api/control`, { nodeId, vmid, action });
  };

  const removeNode = async (id) => {
    if (nodes.length <= 1) return alert("Minimal harus ada 1 node.");
    await axios.post(`${API}/api/nodes/remove`, { id });
  };

  // Filter logic
  const filteredVMs = selectedNodeId ? vms.filter(v => v.nodeId === selectedNodeId) : vms;
  const runningVMs  = filteredVMs.filter(v => v.status === 'running');
  const avgCPU      = runningVMs.length ? Math.round(runningVMs.reduce((s, v) => s + (v.cpu || 0) * 100, 0) / runningVMs.length) : 0;
  const totalRAM    = filteredVMs.reduce((s, v) => s + (v.maxmem || 0), 0);
  const usedRAM     = filteredVMs.reduce((s, v) => s + (v.mem || 0), 0);
  const ramPct      = totalRAM ? Math.round((usedRAM / totalRAM) * 100) : 0;
  
  const issues = [
    ...filteredVMs.filter(v => v.health === 'critical' || v.health === 'warning').map(v => ({ type: 'VM', name: v.name || v.vmid, health: v.health })),
    ...nodeHealth.filter(n => n.health === 'critical' || n.health === 'warning').map(n => ({ type: 'Node', name: n.nodeName, health: n.health }))
  ];

  const handleNodeClick = (nodeId) => {
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId);
    setSubView('main'); // Always go back to main dashboard when filtering
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-logo"><div className="logo-icon">⬡</div><div><div className="logo-text">VM Monitor</div><div className="logo-sub">Multi-Node</div></div></div>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Navigation</div>
          <div className={`sidebar-item ${subView === 'main' && !selectedNodeId ? 'active' : ''}`} onClick={() => { setSubView('main'); setSelectedNodeId(null); }}><span>📊</span> Dashboard</div>
          <div className="sidebar-item" onClick={onChangeVMs}><span>🖥</span> Pilih VM</div>
          <div className={`sidebar-item ${subView === 'traffic' ? 'active' : ''}`} onClick={() => { setSubView('traffic'); setSelectedNodeId(null); }}><span>📈</span> Traffic</div>
          <div className={`sidebar-item ${subView === 'settings' ? 'active' : ''}`} onClick={() => { setSubView('settings'); setSelectedNodeId(null); }}><span>⚙️</span> Settings</div>
        </div>
        <div className="sidebar-connection">
          <div className="sidebar-section-label">Infrastructure Health</div>
          {nodeHealth.length > 0 ? nodeHealth.map(n => (
            <div 
              key={n.nodeId} 
              onClick={() => handleNodeClick(n.nodeId)}
              className={`node-sidebar-card ${selectedNodeId === n.nodeId ? 'active' : ''}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: n.status === 'offline' ? 'var(--red)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {n.status === 'offline' ? '❌' : '●'} {n.nodeName}
                  <span style={{ fontSize: '9px', opacity: 0.4, fontWeight: 400 }}>({n.host})</span>
                </div>
                <div className={`health-badge health-${n.health}`} style={{ fontSize: '9px', padding: '2px 5px' }}>{n.health}</div>
              </div>
              {n.status !== 'offline' && (
                <div style={{ marginTop: '8px' }}>
                  <div className="node-stat-item">
                    <span className="node-stat-label">CPU</span>
                    <span className="node-stat-value">{Math.round((n.cpu || 0) * 100)}%</span>
                  </div>
                  <div className="node-stat-item">
                    <span className="node-stat-label">RAM</span>
                    <span className="node-stat-value">{n.memory ? Math.round((n.memory.used / n.memory.total) * 100) : 0}%</span>
                  </div>
                  <div className="node-stat-item">
                    <span className="node-stat-label">UPTIME</span>
                    <span className="node-stat-value">{formatUptime(n.uptime)}</span>
                  </div>
                </div>
              )}
            </div>
          )) : nodes.map(n => (
            <div key={n.id} style={{ marginBottom: '8px', padding: '8px', background: 'var(--bg4)', borderRadius: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--green)' }}>● {n.nodeName}</div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'monospace' }}>{n.host}</div>
            </div>
          ))}
          <button className="btn btn-danger" style={{ width: '100%', marginTop: '10px', fontSize: '11px' }} onClick={onDisconnect}>Logout System</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>
              {selectedNodeId ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  Node: {nodeHealth.find(n => n.nodeId === selectedNodeId)?.nodeName} 
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedNodeId(null)} style={{ fontSize: '10px', padding: '2px 8px' }}>✕ Clear Filter</button>
                </span>
              ) : (
                subView === 'main' ? 'Global Dashboard' : subView === 'traffic' ? 'Network Analytics' : 'Settings'
              )}
            </h1>
            <div className="sub">Monitoring {filteredVMs.length} VMs {selectedNodeId ? 'on this node' : `on ${nodes.length} Nodes`}</div>
          </div>
          <div className="clock">🕒 {time.toLocaleTimeString('id-ID')}</div>
        </header>

        {subView === 'main' && (
          <div className="fade-in">
            <div className="summary-grid">
              <div className="summary-card green"><div className="summary-icon green">🖥</div><div className="summary-label">Total Instance</div><div className="summary-value normal">{filteredVMs.length}</div></div>
              <div className="summary-card blue"><div className="summary-icon blue">⚡</div><div className="summary-label">Running</div><div className="summary-value normal">{runningVMs.length}</div></div>
              <div className="summary-card purple"><div className="summary-icon purple">💾</div><div className="summary-label">Avg Load</div><div className="summary-value normal">{avgCPU}%</div></div>
              <div className={`summary-card ${issues.length > 0 ? 'red' : 'green'}`}>
                <div className={`summary-icon ${issues.length > 0 ? 'red' : 'green'}`}>{issues.length > 0 ? '⚠️' : '🛡️'}</div>
                <div className="summary-label">System Health</div>
                <div className={`summary-value ${issues.length > 0 ? 'red' : 'green'}`}>{issues.length > 0 ? `${issues.length} Issues` : 'Healthy'}</div>
              </div>
            </div>

            {issues.length > 0 && (
              <div className="alert alert-error fade-in" style={{ marginBottom: '24px', borderLeft: '4px solid var(--red)' }}>
                <div style={{ flex: 1 }}>
                  <strong>Security & Health Alert:</strong> {issues.length} components require attention.
                  <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.8 }}>
                    {issues.slice(0, 3).map(i => `${i.type} ${i.name} (${i.health})`).join(', ')}
                    {issues.length > 3 ? ` and ${issues.length - 3} more...` : ''}
                  </div>
                </div>
              </div>
            )}

            <div className="traffic-card">
              <div className="traffic-header"><div className="section-title">{selectedNodeId ? 'Node Traffic' : 'Aggregated Traffic'}</div><div className="traffic-live"><div className="traffic-live-dot" />{(traffic.current / 1024).toFixed(2)} Mbps</div></div>
              <div className="chart-wrap"><TrafficChart history={traffic.history} /></div>
            </div>
            <div className="vm-list">
              {filteredVMs.map(vm => (
                <VMCard key={`${vm.nodeId}:${vm.vmid}`} vm={vm} onControl={(v, a) => handleControl(v, a, vm.nodeId)} host={vm.nodeHost} />
              ))}
            </div>
          </div>
        )}

        {subView === 'traffic' && (
          <div className="fade-in">
             <div className="traffic-card" style={{ height: '400px' }}><TrafficChart history={traffic.history} /></div>
          </div>
        )}

        {subView === 'settings' && (
          <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div className="card" style={{ padding: '24px' }}>
              <h3>Manage Nodes</h3>
              <div style={{ marginTop: '16px' }}>
                {nodes.map(n => (
                  <div key={n.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg2)', borderRadius: '12px', marginBottom: '10px', border: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{n.nodeName}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{n.host}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeNode(n.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            <ConnectPage isAddingMore onConnected={() => setSubView('main')} />
          </div>
        )}
      </main>
    </div>
  );
}
