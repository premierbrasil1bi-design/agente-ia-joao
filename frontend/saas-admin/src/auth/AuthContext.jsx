import { useState, useEffect, createContext, useContext } from "react";

const TOKEN_KEY = "platform_token";
const USER_KEY = "platform_user";

const AuthContext = createContext();

function readStoredUser() {
  try {
    const u = localStorage.getItem(USER_KEY);
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restaura sessão do localStorage ao montar (e em toda navegação, o provider não desmonta)
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const storedUser = readStoredUser();
    if (token && storedUser) {
      setUser(storedUser);
    } else {
      setUser(null);
    }
    setLoading(false);
  }, []);


  function login(token, admin) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem("adminToken", token);
    localStorage.setItem("token", token);
    localStorage.setItem("accessToken", token);
    localStorage.setItem(USER_KEY, JSON.stringify(admin));
    setUser(admin);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
