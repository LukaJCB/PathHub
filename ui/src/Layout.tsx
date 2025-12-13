import { useAuth } from "./useAuth";
import { Outlet } from "react-router";

export function Layout() {
  const {logout} = useAuth()
  return (
    <>
      <header><button onClick={logout}>Click here to log out!</button>
      </header>
      <Outlet/>
    </>
  );
}