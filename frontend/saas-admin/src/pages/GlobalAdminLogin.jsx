import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { globalAdminApi } from "../services/globalAdminApi";
import "./GlobalAdminLogin.css";

export default function GlobalAdminLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await globalAdminApi.login(email, password);
      localStorage.setItem("platform_token", data.token);
      localStorage.setItem("platform_user", JSON.stringify(data.admin));
      login(data.token, data.admin);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Credenciais inválidas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="global-admin-login" role="main" aria-label="Página de login do administrador global">
      <div className="global-admin-login__card">
        <h1 className="global-admin-login__title">Global Admin</h1>
        <p className="global-admin-login__subtitle">Entre com suas credenciais para acessar o painel.</p>
        <form onSubmit={handleSubmit} className="global-admin-login__form" noValidate>
          {error && (
            <div id="ga-error" className="global-admin-login__error" role="alert">
              {error}
            </div>
          )}
          <label className="global-admin-login__label" htmlFor="ga-email">
            Email
          </label>
          <input
            id="ga-email"
            type="email"
            autoComplete="email"
            className="global-admin-login__input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            aria-invalid={!!error}
            aria-describedby={error ? "ga-error" : undefined}
          />
          <label className="global-admin-login__label" htmlFor="ga-password">
            Senha
          </label>
          <input
            id="ga-password"
            type="password"
            autoComplete="current-password"
            className="global-admin-login__input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            aria-invalid={!!error}
          />
          <button
            type="submit"
            className="global-admin-login__submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
