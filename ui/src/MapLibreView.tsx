import React, { useEffect, useRef } from "react";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  route: [number, number, number][];
  showMarkers?: boolean;
  width?: string;
  height?: string;
};

const MapLibreRouteMap: React.FC<Props> = ({
  route,
  showMarkers = true,
  width = "100%",
  height = "500px"
}) => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || !route.length) return;

    const coordinates: [number, number][] = route.map(([lat, lng]) => [lng, lat] as const);

    const bounds: LngLatBoundsLike = coordinates.reduce(
      (b, coord) => b.extend(coord),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm"
          }
        ]
      },
      interactive: true
    });

    mapInstance.current = map;

    map.on("load", () => {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates
          },
          properties: []
        }
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
            "line-cap": "round",
            "line-join": "round"
        },
        paint: {
            "line-color": "red",
            "line-width": 3
        }
      });



      if (showMarkers) {
        new maplibregl.Marker().setLngLat(coordinates[0]).addTo(map);
        new maplibregl.Marker()
          .setLngLat(coordinates[coordinates.length - 1])
          .addTo(map);
      }

      map.fitBounds(bounds, {
        padding: 40,
        animate: false
      });
    });

    return () => {
      map.remove();
    };
  }, [route, showMarkers]);

  return <div ref={mapRef} style={{ width, height }} />;
};

export default MapLibreRouteMap;
