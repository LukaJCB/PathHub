import { useContext } from "react";
import { AuthContext } from "./authContext.js";

export function useAuth() {
  const ctx = useContext(AuthContext);
  ctx?.user
  if (!ctx) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return ctx;
}

export function useAuthRequired() {
  const { user, ...rest } = useAuth();
  if (!user) {
    throw new Error("useAuthRequired must be used inside a ProtectedRoute");
  }
  return { user, ...rest };
};