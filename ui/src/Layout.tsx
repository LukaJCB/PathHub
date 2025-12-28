import { useAuth } from "./useAuth";
import { Link, Outlet } from "react-router";

import imgUrl from './assets/logo.png';

export function Layout() {
  const {logout, user} = useAuth()
  return (
    <>
      <header>
        <Link to="/"><img src={imgUrl} style={{width: "120px"}}></img>
        <h1>Pathhub</h1>
        </Link>

        <button onClick={logout}>Click here to log out!</button>
        <p>Logged in as {user?.name}</p>
      </header>
      <Outlet/>
    </>
  );
}