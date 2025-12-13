import { Navigate } from "react-router";
import { useAuth } from "./useAuth.js";
import { JSX } from "react";

interface PublicOnlyRouteProps {
  children: JSX.Element;
}

export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const { user } = useAuth();

  if (user) {
    return <Navigate to="/" replace />;
  }

  return children;
}
