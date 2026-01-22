import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet';
import { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import React from 'react';

// Fix missing default marker icons in Leaflet (important for Webpack/Vite)
import L from 'leaflet';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type Props = {
  route: [number, number, number][];
  showMarkers?: boolean;
  width?: string;  
  height?: string; 
};

const LeafletRouteMap: React.FC<Props> = ({ route, showMarkers = true, width = "100%", height = "500px" }) => {
  if (!route || route.length === 0) return null;

  const center: LatLngExpression = route[Math.floor(route.length / 2)]!;


  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom={true}
      style={{ width, height }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Polyline positions={route} color="red" />

      {showMarkers && (
        <>
          <Marker position={route[0]!} />
          <Marker position={route[route.length - 1]!} />
        </>
      )}
    </MapContainer>
  );
};

export default LeafletRouteMap;
