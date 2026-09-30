import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { cn } from "@/lib/cn";
import { latLngAtPin, pinContainerPoint, setViewAtPin } from "@/lib/mapAnchor";
import { useAppStore } from "@/store/useAppStore";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type PinMapHandle = {
  setView: (lat: number, lng: number, zoom?: number) => void;
  getCenter: () => { lat: number; lng: number } | null;
};

type Props = {
  lat: number;
  lng: number;
  zoom?: number;
  interactive?: boolean;
  bottomPadding?: number;
  className?: string;
  children?: ReactNode;
  onDragStart?: () => void;
  onMoveEnd?: (lat: number, lng: number) => void;
};

const PinMap = forwardRef<PinMapHandle, Props>(function PinMap(
  { lat, lng, zoom = 16, interactive = true, bottomPadding = 0, className, children, onDragStart, onMoveEnd },
  ref,
) {
  const theme = useAppStore((s) => s.theme);
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const padRef = useRef(bottomPadding);
  const start = useRef({ lat, lng, zoom });
  const onMoveEndRef = useRef(onMoveEnd);
  const onDragStartRef = useRef(onDragStart);
  onMoveEndRef.current = onMoveEnd;
  onDragStartRef.current = onDragStart;
  const [pinTop, setPinTop] = useState(0);

  const syncPinTop = (map: L.Map, padding: number) => {
    const point = pinContainerPoint(map.getSize(), padding);
    setPinTop(point.y);
  };

  useImperativeHandle(ref, () => ({
    setView: (nextLat, nextLng, nextZoom) => {
      const map = mapRef.current;
      if (!map) return;
      setViewAtPin(map, nextLat, nextLng, nextZoom ?? map.getZoom(), padRef.current, true);
    },
    getCenter: () => {
      const map = mapRef.current;
      if (!map) return null;
      const center = latLngAtPin(map, padRef.current);
      return { lat: center.lat, lng: center.lng };
    },
  }), []);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      inertia: true,
    }).setView([start.current.lat, start.current.lng], start.current.zoom);
    L.control.attribution({ prefix: false, position: "bottomleft" }).addTo(map);
    L.tileLayer(OSM_TILES, {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    map.on("dragstart", () => onDragStartRef.current?.());
    map.on("moveend", () => {
      const center = latLngAtPin(map, padRef.current);
      onMoveEndRef.current?.(center.lat, center.lng);
      syncPinTop(map, padRef.current);
    });
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      setViewAtPin(map, start.current.lat, start.current.lng, start.current.zoom, padRef.current, false);
      syncPinTop(map, padRef.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    const prev = padRef.current;
    if (!map) {
      padRef.current = bottomPadding;
      return;
    }
    const here = latLngAtPin(map, prev);
    padRef.current = bottomPadding;
    map.invalidateSize();
    setViewAtPin(map, here.lat, here.lng, map.getZoom(), bottomPadding, false);
    syncPinTop(map, bottomPadding);
  }, [bottomPadding]);

  useEffect(() => {
    const node = wrap.current;
    const map = mapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      if (!mapRef.current) return;
      mapRef.current.invalidateSize();
      syncPinTop(mapRef.current, padRef.current);
    });
    ro.observe(node);
    if (map) syncPinTop(map, padRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrap}
      className={cn(
        "relative z-0 h-full w-full leaflet-uber-tiles",
        theme === "dark" && "leaflet-dark-tiles",
        className,
      )}
    >
      <div ref={el} className="h-full w-full" />
      {children && (
        <div
          className="absolute left-1/2 z-20 -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{ top: pinTop || "42%" }}
        >
          {children}
        </div>
      )}
    </div>
  );
});

export default PinMap;
