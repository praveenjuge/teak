import { useState, useEffect } from "react";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt?: string;
}

interface Stats {
  totalUsers: number;
  activeUsers: number;
  revenue: number;
  growth: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  message?: string;
  error?: string;
}

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "user" });
  const [submitting, setSubmitting] = useState(false);

  const API_BASE = "/api";

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/users`);
      const result: ApiResponse<User[]> = await response.json();
      if (result.success) {
        setUsers(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/stats`);
      const result: ApiResponse<Stats> = await response.json();
      if (result.success) {
        setStats(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name || !newUser.email) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newUser),
      });

      const result: ApiResponse<User> = await response.json();

      if (result.success) {
        setUsers((prev) => [...prev, result.data]);
        setNewUser({ name: "", email: "", role: "user" });
      } else {
        alert(result.error || "Failed to create user");
      }
    } catch (error) {
      console.error("Failed to create user:", error);
      alert("Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchUsers(), fetchStats()]);
      setLoading(false);
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🌿 Teak Dashboard</h1>
        <p>Modern Dockerized Web Application</p>
      </header>

      <main className="main">
        {stats && (
          <section className="stats">
            <h2>📊 Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Users</h3>
                <p className="stat-number">
                  {stats.totalUsers.toLocaleString()}
                </p>
              </div>
              <div className="stat-card">
                <h3>Active Users</h3>
                <p className="stat-number">
                  {stats.activeUsers.toLocaleString()}
                </p>
              </div>
              <div className="stat-card">
                <h3>Revenue</h3>
                <p className="stat-number">${stats.revenue.toLocaleString()}</p>
              </div>
              <div className="stat-card">
                <h3>Growth</h3>
                <p className="stat-number">{stats.growth}%</p>
              </div>
            </div>
          </section>
        )}

        <section className="users">
          <div className="users-header">
            <h2>👥 Users ({users.length})</h2>
            <button onClick={fetchUsers} className="refresh-btn">
              🔄 Refresh
            </button>
          </div>

          <div className="users-list">
            {users.map((user) => (
              <div key={user.id} className="user-card">
                <div className="user-info">
                  <h3>{user.name}</h3>
                  <p>{user.email}</p>
                  <span className={`role ${user.role}`}>{user.role}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="add-user">
          <h2>➕ Add New User</h2>
          <form onSubmit={handleSubmit} className="user-form">
            <div className="form-group">
              <input
                type="text"
                placeholder="Name"
                value={newUser.name}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, name: e.target.value }))
                }
                required
              />
            </div>
            <div className="form-group">
              <input
                type="email"
                placeholder="Email"
                value={newUser.email}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, email: e.target.value }))
                }
                required
              />
            </div>
            <div className="form-group">
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser((prev) => ({ ...prev, role: e.target.value }))
                }
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="submit" disabled={submitting} className="submit-btn">
              {submitting ? "⏳ Creating..." : "✅ Create User"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

export default App;
