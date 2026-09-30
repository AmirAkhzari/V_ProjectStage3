import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Address } from "@/types";

const PIN = L.divIcon({
  className: "",
  html: '<span style="display:block;width:14px;height:14px;border-radius:50%;background:#000;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export default function AddressMap({ addresses, height = 320 }: { addresses: Address[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    L.control.zoom({ position: "topleft" }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    if (addresses.length) {
      addresses.forEach((a) =>
        L.marker([a.lat, a.lng], { icon: PIN }).bindTooltip(a.title, { direction: "top" }).addTo(layer),
      );
      const bounds = L.latLngBounds(addresses.map((a) => [a.lat, a.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.4), { maxZoom: 15 });
    } else {
      map.setView([35.6892, 51.389], 6);
    }
    return () => {
      layer.remove();
    };
  }, [addresses]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
