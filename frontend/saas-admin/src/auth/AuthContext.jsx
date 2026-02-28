import { useState, createContext, useContext } from "react";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem("platform_user");
    return u ? JSON.parse(u) : null;
  });

  function login(token, admin) {
    localStorage.setItem("platform_token", token);
    localStorage.setItem("platform_user", JSON.stringify(admin));
    setUser(admin);
  }

  function logout() {
    localStorage.removeItem("platform_token");
    localStorage.removeItem("platform_user");
    setUser(null);
  }

  function getToken() {
    return localStorage.getItem("platform_token");
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
