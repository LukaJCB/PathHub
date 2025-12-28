import { useAuth } from "./useAuth";
import { Link, Outlet } from "react-router";

import imgUrl from './assets/logo.png';

export function Layout() {
  const {logout, user} = useAuth()
  return (
    <>
      <header className="bg-white shadow-md sticky top-0 z-50">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src={imgUrl} alt="PathHub Logo" className="w-12 h-12 rounded-lg" />
              <h1 className="text-2xl font-bold text-gray-900">PathHub</h1>
            </Link>

            <div className="flex items-center gap-6">
              {user && (
                <>
                  <span className="text-gray-700 text-sm">Welcome, <Link to={`/user/${user.id}/0`}><span className="font-semibold">{user.name}</span></Link></span>
                  <button 
                    onClick={logout}
                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg transition-colors"
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          </div>
        </nav>
      </header>
      <main className="min-h-screen bg-gray-50">
        <Outlet/>
      </main>
    </>
  );
}