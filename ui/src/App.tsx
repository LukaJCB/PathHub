import { useState } from 'react'
import LeafletRouteMap from './LeafleftMapView.js';
import FileUpload from './FileUploader.js';
import { useAuth, useAuthRequired } from './useAuth.js';
import ProfileView from './ProfileView.js';
import { Link } from 'react-router';
import { ZipExtractor } from './Import.js';



function App() {
  const {user} = useAuthRequired()

  return (
    <>
      <h2>Pathhub</h2>
      <ZipExtractor />
      <ProfileView userId={user.id} username={user.name} manifest={user.currentManifest} />
      <Link to="/upload">Click here to Upload an Activity!</Link>
    </>
  );
}

export default App
