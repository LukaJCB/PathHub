import { Navigate } from "react-router";
import { useAuth } from "./useAuth.js";
import { JSX } from "react";

interface ProtectedRouteProps {
  children: JSX.Element;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
