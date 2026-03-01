import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { adminApi } from "../api/admin";
import { Button, Input } from "../components/ui";
import styles from "./Login.module.css";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await adminApi.login(email, password);
      login(data.token, data.admin);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message ?? "Credenciais inválidas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.left}>
        <div className={styles.card}>
          <h1 className={styles.brand}>OMNIA AI</h1>
          <p className={styles.subtitle}>Admin Global</p>
          <p className={styles.hint}>Entre com suas credenciais para acessar o painel.</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@exemplo.com"
              required
            />
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {error && <p className={styles.error}>{error}</p>}
            <Button type="submit" disabled={loading} className={styles.submit}>
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
      <div className={styles.right} />
    </div>
  );
}
