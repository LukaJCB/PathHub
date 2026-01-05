import { useAuth } from "./useAuth";
import { Link, Outlet } from "react-router";
import { useIsFetching } from "@tanstack/react-query";
import imgUrl from './assets/logo.png';

export function Layout() {
  const {logout, user} = useAuth()
  const initials = user?.name ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : ''
  const isProcessing = useIsFetching({ queryKey: ["messages"], exact: false }) > 0;
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
                  <Link
                    to="/search"
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                  >
                    Search
                  </Link>
                  <div className="flex items-center gap-3">
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt={`${user.name} avatar`} className="w-9 h-9 rounded-full object-cover ring-2 ring-indigo-100" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-semibold">
                        {initials}
                      </div>
                    )}
                    <span className="text-gray-700 text-sm">Welcome, <Link to={`/user/${user.id}`}><span className="font-semibold">{user.name}</span></Link></span>
                  </div>
                  <Link
                    to="/followRequests"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                  >
                    Follow Requests
                  </Link>
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
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                © 2026 PathHub. All rights reserved.
              </p>
              {isProcessing && (
                <div className="flex items-center gap-2 text-sm text-indigo-600">
                  <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <span>Processing messages...</span>
                </div>
              )}
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}