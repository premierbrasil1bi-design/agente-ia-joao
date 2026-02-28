import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { request } from "../api/http";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await request("/api/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Login inválido");
      const data = await res.json();
      login(data.token, data.admin);
      window.location = "/tenants";
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-page">
      <form onSubmit={handleSubmit}>
        <h2>Login Admin Global</h2>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Senha"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />
        <button type="submit">Entrar</button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
