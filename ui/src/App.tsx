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
      <Link to={`/user/${user.id}/0`} > {user.name} </Link><div/>
      <Link to="/upload">Click here to Upload an Activity!</Link>
    </>
  );
}

export default App
