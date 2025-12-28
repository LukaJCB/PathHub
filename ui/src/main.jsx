import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from "react-router";
import App from './App.jsx'
import './App.css'
import RegistrationView from './RegistrationView.js';
import LoginView from './LoginView.js';
import FileUpload from './FileUploader.js';
import { ProtectedRoute } from './ProtectedRoute.js';
import { AuthProvider } from './AuthProvider.js';
import { PublicOnlyRoute } from './PublicOnlyRoute.js';
import PostView from './PostView.js';
import { Layout } from './Layout.js';
import ProfileView from './ProfileView.js';
import FollowRequestsView from './FollowRequests.js';
import FollowerView from './FollowerView.js';
import FollowingView from './FollowingView.js';
import { BulkImport } from './Import.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ProtectedRoute><App /></ProtectedRoute>} />
            <Route path="upload" element={<ProtectedRoute><FileUpload /></ProtectedRoute>} />
            <Route path="bulkImport" element={<ProtectedRoute><BulkImport /></ProtectedRoute>} />
            <Route path="user/:userId/:page">
              <Route index element={<ProtectedRoute><ProfileView /></ProtectedRoute>} />
              <Route path=":storageId" element={<ProtectedRoute><PostView /></ProtectedRoute>} />
            </Route>
            <Route path="followRequests" element={<ProtectedRoute><FollowRequestsView /></ProtectedRoute>} />
            <Route path="followers" element={<ProtectedRoute><FollowerView /></ProtectedRoute>} />
            <Route path="following" element={<ProtectedRoute><FollowingView /></ProtectedRoute>} />
          </Route>
          <Route path="register" element={<PublicOnlyRoute><RegistrationView /></PublicOnlyRoute>} />
          <Route path="login" element={<PublicOnlyRoute><LoginView /></PublicOnlyRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>
)
